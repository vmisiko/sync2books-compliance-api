import type { Repository } from 'typeorm';
import type { CatalogItem } from '../../domain/entities/catalog-item.entity';
import type { ICatalogItemRepository } from '../../domain/ports/item-repository.port';
import type { IComplianceConnectionRepository } from '../../../shared/ports/repository.port';
import type { IEtimsAdapter } from '../../../regulatory/oscu/ports/etims-adapter.port';
import type { OscuItemSaveReq } from '../../../regulatory/oscu/transport/endpoints/item-save.dto';
import { OscuSyncStateOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';

export interface SyncItemsInput {
  merchantId: string;
  branchId: string;
  itemIds?: string[];
  /**
   * When true, only sync items in PENDING/FAILED state.
   * Defaults to true.
   */
  onlyPending?: boolean;
  /**
   * When true, sync even if already REGISTERED (forces re-save).
   * Defaults to false.
   */
  force?: boolean;
}

export type SyncItemResult = {
  itemId: string;
  itemCd: string;
  success: boolean;
  resultCd: string | null;
  resultMsg: string | null;
  error: string | null;
};

export interface SyncItemsResult {
  merchantId: string;
  branchId: string;
  attempted: number;
  synced: number;
  failed: number;
  results: SyncItemResult[];
}

/**
 * itemCd's qtyUnitCd(2)/pkgUnitCd(2) slots are a fixed-width identifier
 * component, not the canonical unit value -- the real unit still goes out
 * unmodified in the payload's separate qtyUnitCd/pkgUnitCd fields. Confirmed
 * empirically against the sandbox (2026-08-10, PIN P600004123A): a real,
 * valid business code like "U" (Pieces/item, 1 char) is accepted fine as
 * the separate field but rejected with `400 "Incorrect QtyUnitCd Prefix"`
 * when embedded here. So when a merchant's real code isn't exactly 2 chars
 * (many legitimate KRA codes aren't -- "U", "BLL", etc.), substitute one of
 * KRA's own 2-char codes for the slot instead of failing the whole sync.
 */
const QTY_UNIT_CD_SLICE_FALLBACK = 'NO'; // "Number" (cdCls 10) -- generic, always valid
const PKG_UNIT_CD_SLICE_FALLBACK = 'NT'; // "Not applicable" (cdCls 17) -- generic, always valid

/**
 * Bounds isItemCdSequenceDriftRejection's self-heal loop. Covers realistic
 * drift from casual local/shared-tin testing (a handful to a few dozen
 * items) while still failing visibly, instead of looping forever, if the
 * connection is broken in some other way that happens to produce the same
 * message.
 */
const MAX_ITEM_CD_DRIFT_RETRIES = 25;

function itemCdSlice(code: string, fallback: string): string {
  return code.length === 2 ? code : fallback;
}

/**
 * OSCU `itemCd` format, per spec section 4.19 "Item Code":
 * `orgnNatCd(2) + itemTyCd(1) + pkgUnitCd(2) + qtyUnitCd(2) + seq(7 digits, from 0000001)`
 * e.g. "KE2NTBA0000012".
 *
 * seq MUST be 7 digits, not 8, and must be the next unused value for this tin
 * (KRA rejected an out-of-order 7-digit seq with
 * `400 "Invalid itemCd Sequence. Expected sequence ending with: ********1"`).
 */
function generateEtimsItemCd(
  item: {
    productTypeCode: string;
    packagingUnitCode: string;
    unitCode: string;
  },
  seq: number,
): string {
  const orgnNatCd = 'KE';
  const pkgUnitCdSlice = itemCdSlice(
    item.packagingUnitCode,
    PKG_UNIT_CD_SLICE_FALLBACK,
  );
  const qtyUnitCdSlice = itemCdSlice(item.unitCode, QTY_UNIT_CD_SLICE_FALLBACK);
  const seqStr = seq.toString().padStart(7, '0');
  if (seqStr.length > 7) {
    throw new Error(`itemCd sequence overflowed 7 digits: ${seq}`);
  }
  return `${orgnNatCd}${item.productTypeCode}${pkgUnitCdSlice}${qtyUnitCdSlice}${seqStr}`;
}

/**
 * KRA validates the itemCd sequence is strictly incrementing per tin, starting at
 * 0000001 -- not just unique. Track the last-issued value per (kraPin, environment)
 * in `oscu_sync_state` (same table used for other OSCU watermarks) and hand out the
 * next one. Only called when an item doesn't already have a persisted itemCd, so
 * retries of the same item never burn a new sequence number.
 */
async function allocateItemCdSequence(
  syncStateRepo: Repository<OscuSyncStateOrmEntity>,
  kraPin: string,
  environment: string,
): Promise<number> {
  const syncKey = `item_cd_seq:${kraPin}:${environment}`;
  const existing = await syncStateRepo.findOne({ where: { syncKey } });
  const next = (existing?.lastReqDt ? parseInt(existing.lastReqDt, 10) : 0) + 1;
  await syncStateRepo.upsert({ syncKey, lastReqDt: String(next) }, ['syncKey']);
  return next;
}

/**
 * Mirror of releaseInvoiceSequence (submit-document.usecase.ts): a permanent
 * (non-retryable) saveItem rejection means KRA never accepted this itemCd, so
 * give the sequence value back rather than leaving the counter permanently
 * ahead of what KRA has actually seen. Only rolls back if no one else has
 * advanced past this value in the meantime.
 *
 * Retryable failures (network errors, OSCU 9xx codes) deliberately do NOT call
 * this -- allocateItemCdSequence's `if (!itemCd)` guard means a retry reuses
 * the same itemCd, which is what KRA expects next regardless. Releasing here
 * only applies once we're confident this exact itemCd will never be
 * resubmitted -- see the etimsItemCode reset next to this function's call site.
 */
async function releaseItemCdSequence(
  syncStateRepo: Repository<OscuSyncStateOrmEntity>,
  kraPin: string,
  environment: string,
  seq: number,
): Promise<void> {
  const syncKey = `item_cd_seq:${kraPin}:${environment}`;
  const existing = await syncStateRepo.findOne({ where: { syncKey } });
  const current = existing?.lastReqDt ? parseInt(existing.lastReqDt, 10) : 0;
  if (current === seq) {
    await syncStateRepo.upsert({ syncKey, lastReqDt: String(seq - 1) }, [
      'syncKey',
    ]);
  }
}

/** itemCd's trailing 7 chars are always the sequence, by construction (see
 * generateEtimsItemCd) -- pull it back out to release it. */
function parseItemCdSeq(itemCd: string): number | null {
  const tail = itemCd.slice(-7);
  const seq = parseInt(tail, 10);
  return Number.isNaN(seq) ? null : seq;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s === '' ? null : s;
}

/**
 * KRA rejects an itemCd whose sequence tail doesn't match what it expects
 * next for this tin -- confirmed live 2026-08-31 (shared sandbox PIN
 * P600004185A): a shared tin gets submitted to from more than one database
 * (e.g. local dev and a deployed environment), each tracking its own
 * independent `oscu_sync_state` counter, so whichever one falls behind gets
 * this rejection on every single item from then on. It's classified HTTP
 * 400 (non-retryable) by isRetryableStatus, so without this, clicking
 * "Retry Sync" just re-burns the exact same wrong sequence forever.
 *
 * Matched on KRA's stable message substrings rather than trying to parse
 * the numeric tail out of its response -- KRA masks a different number of
 * digits with asterisks in different rejections ("********1" vs
 * "********11" have both been observed live), so the revealed suffix isn't
 * reliably a usable sequence value.
 */
function isItemCdSequenceDriftRejection(message: string | null): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('itemcd') &&
    (m.includes('reused') ||
      m.includes('not incremented properly') ||
      m.includes('invalid itemcd sequence'))
  );
}

export async function syncItemsToEtims(
  input: SyncItemsInput,
  deps: {
    itemRepo: ICatalogItemRepository;
    connectionRepo: IComplianceConnectionRepository;
    etimsAdapter: IEtimsAdapter;
    syncStateRepo: Repository<OscuSyncStateOrmEntity>;
  },
): Promise<SyncItemsResult> {
  const onlyPending = input.force ? false : (input.onlyPending ?? true);

  const connection = await deps.connectionRepo.findByMerchantAndBranch(
    input.merchantId,
    input.branchId,
  );
  if (!connection) {
    throw new Error(
      `No active eTIMS connection for merchant=${input.merchantId} branch=${input.branchId}`,
    );
  }
  if (!connection.kraBhfId) {
    throw new Error(
      `Branch ${input.branchId} has no KRA branch office id (kraBhfId) set`,
    );
  }

  const all = await deps.itemRepo.findByMerchant(input.merchantId);
  const picked = input.itemIds?.length
    ? all.filter((i) => input.itemIds!.includes(i.id))
    : all;

  const toSync = onlyPending
    ? picked.filter((i) => i.registrationStatus !== 'REGISTERED')
    : picked;

  const results: SyncItemResult[] = [];
  for (const item of toSync) {
    // itemTyCd is required by saveItem and embedded in itemCd itself, but
    // this system never guesses it (see CatalogItem.productTypeCode's doc
    // comment) -- an item still pending that choice can't be synced at all.
    // Surfaced as an explicit skipped/failed result rather than silently
    // dropped, so it's visible in the sync outcome instead of just vanishing.
    // Bound to a local so it narrows to `string` for generateEtimsItemCd
    // below -- narrowing `item.productTypeCode` alone wouldn't narrow
    // `item`'s own type when the whole object is passed elsewhere.
    const productTypeCode = item.productTypeCode;
    if (productTypeCode == null) {
      results.push({
        itemId: item.id,
        itemCd: item.etimsItemCode ?? '',
        success: false,
        resultCd: null,
        resultMsg: null,
        error:
          'This item has no product type set (Raw Material / Finished Product / Service) -- set it before syncing to KRA.',
      });
      continue;
    }

    // Classification/quantity-unit/packaging-unit resolution can come back
    // unresolved ('' -- see CatalogItem.classificationCode's doc comment)
    // for an item pulled from an ERP with none of the three set yet (no ERP
    // supplies any of them -- see Item Sync's Add/Edit/Bulk Edit for the
    // only way they get set). Such an item still registers locally
    // (needsClassificationMapping
    // true) so it's visible and fixable in Item Sync, but saveItem requires
    // all three -- skip it here with a clear per-item reason rather than
    // submitting blank/malformed codes to KRA.
    if (
      item.classificationCode === '' ||
      item.unitCode === '' ||
      item.packagingUnitCode === ''
    ) {
      results.push({
        itemId: item.id,
        itemCd: item.etimsItemCode ?? '',
        success: false,
        resultCd: null,
        resultMsg: null,
        error:
          'This item is missing its classification and/or unit codes -- resolve them via Mapping Center or edit the item before syncing to KRA.',
      });
      continue;
    }

    // Everything in this iteration -- itemCd generation included -- must stay
    // inside the try. A single malformed item (e.g. a unitCode that isn't
    // exactly 2 chars) used to throw here uncaught, which aborted the whole
    // batch with a bare 500 instead of recording just that item as FAILED
    // and continuing with the rest.
    try {
      let itemCd = normalizeNonEmptyString(item.etimsItemCode);

      let res: Awaited<ReturnType<IEtimsAdapter['saveItem']>>;
      let resultCd: string | null;
      let resultMsg: string | null;
      let isDrift = false;
      let driftRetries = 0;

      for (;;) {
        if (!itemCd) {
          const seq = await allocateItemCdSequence(
            deps.syncStateRepo,
            connection.kraPin,
            connection.environment,
          );
          itemCd = generateEtimsItemCd({ ...item, productTypeCode }, seq);
        }

        const request: OscuItemSaveReq = {
          tin: connection.kraPin,
          bhfId: connection.kraBhfId,
          cmcKey: connection.cmcKey,
          itemClsCd: item.classificationCode,
          itemCd,
          itemTyCd: productTypeCode,
          itemNm: item.name,
          itemStdNm: null,
          orgnNatCd: item.originCountry ?? 'KE',
          pkgUnitCd: item.packagingUnitCode,
          qtyUnitCd: item.unitCode,
          taxTyCd: item.taxTyCd,
          btchNo: null,
          bcd: item.sku ?? null,
          dftPrc: item.unitPrice ?? 0,
          grpPrcL1: 0,
          grpPrcL2: 0,
          grpPrcL3: 0,
          grpPrcL4: 0,
          grpPrcL5: null,
          addInfo: null,
          sftyQty: null,
          isrcAplcbYn: 'N',
          useYn: 'Y',
          regrId: 'sync2books',
          regrNm: 'sync2books',
          modrId: 'sync2books',
          modrNm: 'sync2books',
        };

        res = await deps.etimsAdapter.saveItem(request, {
          merchantId: input.merchantId,
          branchId: connection.kraBhfId,
          kraPin: connection.kraPin,
          environment: connection.environment,
          cmcKey: connection.cmcKey,
          deviceId: connection.deviceId,
        });

        // The HTTP adapter's rawResponse fields go through `safeString()` on its
        // side, which returns '' (not undefined) when the raw KRA/Apigee body
        // has no resultCd/resultMsg key at all -- e.g. a gateway-level
        // rejection that never reached KRA's own envelope. A bare `?? null`
        // here doesn't catch that ('' is not nullish), so a genuinely blank
        // resultMsg would silently block the `res.error` fallback below from
        // ever running -- normalize through the same helper used for itemCd
        // so "blank" and "absent" are treated identically everywhere.
        resultCd = normalizeNonEmptyString(res.rawResponse?.resultCd);
        resultMsg = normalizeNonEmptyString(res.rawResponse?.resultMsg);

        if (res.success) break;

        isDrift = isItemCdSequenceDriftRejection(
          resultMsg ?? res.error ?? null,
        );
        if (isDrift && driftRetries < MAX_ITEM_CD_DRIFT_RETRIES) {
          driftRetries += 1;
          itemCd = null; // force a fresh allocation next iteration
          continue;
        }
        break;
      }

      const now = new Date();

      if (res.success) {
        const updated: CatalogItem = {
          ...item,
          etimsItemCode: itemCd,
          registrationStatus: 'REGISTERED',
          lastSyncedAt: now,
          lastSyncAttemptAt: now,
          lastSyncResultCd: resultCd ?? '000',
          lastSyncResultMsg: resultMsg ?? 'OK',
          updatedAt: now,
        };
        await deps.itemRepo.save(updated);
        results.push({
          itemId: item.id,
          itemCd,
          success: true,
          resultCd: updated.lastSyncResultCd,
          resultMsg: updated.lastSyncResultMsg,
          error: null,
        });
        continue;
      }

      const retryable = (res.error ?? '').includes('retryable');
      // A drift rejection must never release its sequence back -- doing so
      // would decrement the counter right back to the value KRA just
      // rejected, guaranteeing the identical failure on the next attempt.
      // Leaving the counter where the drift loop advanced it to is the
      // whole point of the self-heal, whether it exhausted its retry budget
      // or the item is skipped for some other reason.
      if (!retryable && !isDrift) {
        const seq = parseItemCdSeq(itemCd);
        if (seq != null) {
          await releaseItemCdSequence(
            deps.syncStateRepo,
            connection.kraPin,
            connection.environment,
            seq,
          );
        }
      }

      const updated: CatalogItem = {
        ...item,
        // Retryable failures keep their itemCd so a retry reuses it (see
        // releaseItemCdSequence's comment). A permanent rejection releases the
        // sequence value above, so the item must be cleared back to null too --
        // otherwise a later retry would resubmit a number that may since have
        // been handed to a different item.
        etimsItemCode: retryable ? itemCd : null,
        registrationStatus: 'FAILED',
        lastSyncAttemptAt: now,
        lastSyncResultCd: resultCd,
        // A failure that never got a KRA envelope back (network error, DNS
        // failure, timeout -- res.rawResponse is undefined) has no
        // resultCd/resultMsg to persist, but res.error still carries the
        // real reason (e.g. "retryable: fetch failed"). Without this
        // fallback, the item detail drawer's "Error from KRA / backend"
        // section (which only renders when lastSyncResultMsg is set) stayed
        // silent for exactly the failures a merchant/support agent most
        // needs to see -- the ones that never reached KRA at all.
        lastSyncResultMsg: resultMsg ?? res.error ?? null,
        updatedAt: now,
      };
      await deps.itemRepo.save(updated);
      results.push({
        itemId: item.id,
        itemCd,
        success: false,
        resultCd,
        resultMsg,
        error: res.error ?? 'Unknown error',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now = new Date();
      const updated: CatalogItem = {
        ...item,
        registrationStatus: 'FAILED',
        lastSyncAttemptAt: now,
        lastSyncResultCd: null,
        lastSyncResultMsg: message,
        updatedAt: now,
      };
      await deps.itemRepo.save(updated);
      results.push({
        itemId: item.id,
        itemCd: item.etimsItemCode ?? '',
        success: false,
        resultCd: null,
        resultMsg: null,
        error: message,
      });
    }
  }

  const synced = results.filter((r) => r.success).length;
  const failed = results.length - synced;

  return {
    merchantId: input.merchantId,
    branchId: input.branchId,
    attempted: results.length,
    synced,
    failed,
    results,
  };
}
