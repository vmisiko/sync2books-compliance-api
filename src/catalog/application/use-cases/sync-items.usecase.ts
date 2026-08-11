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
 * OSCU `itemCd` format, per spec section 4.19 "Item Code":
 * `orgnNatCd(2) + itemTyCd(1) + pkgUnitCd(2) + qtyUnitCd(2) + seq(7 digits, from 0000001)`
 * e.g. "KE2NTBA0000012".
 *
 * Confirmed empirically against the sandbox (2026-08-10, PIN P600004123A):
 * - qtyUnitCd MUST be exactly 2 characters -- a 1-char code (e.g. "U") is rejected
 *   with `400 "Incorrect QtyUnitCd Prefix"` even with an otherwise well-formed itemCd.
 * - seq MUST be 7 digits, not 8, and must be the next unused value for this tin
 *   (KRA rejected an out-of-order 7-digit seq with
 *   `400 "Invalid itemCd Sequence. Expected sequence ending with: ********1"`).
 */
function generateEtimsItemCd(
  item: {
    productTypeCode: string;
    packagingUnitCode: string;
    unitCode: string;
  },
  seq: number,
): string {
  if (item.unitCode.length !== 2) {
    throw new Error(
      `qtyUnitCd "${item.unitCode}" must be exactly 2 characters to embed in an OSCU itemCd ` +
        `(spec section 4.19) -- fix the unit mapping for this item instead of guessing a padding scheme`,
    );
  }
  const orgnNatCd = 'KE';
  const seqStr = seq.toString().padStart(7, '0');
  if (seqStr.length > 7) {
    throw new Error(`itemCd sequence overflowed 7 digits: ${seq}`);
  }
  return `${orgnNatCd}${item.productTypeCode}${item.packagingUnitCode}${item.unitCode}${seqStr}`;
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

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s === '' ? null : s;
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
    let itemCd = normalizeNonEmptyString(item.etimsItemCode);
    if (!itemCd) {
      const seq = await allocateItemCdSequence(
        deps.syncStateRepo,
        connection.kraPin,
        connection.environment,
      );
      itemCd = generateEtimsItemCd(item, seq);
    }
    const now = new Date();

    const request: OscuItemSaveReq = {
      tin: connection.kraPin,
      bhfId: connection.kraBhfId,
      cmcKey: connection.cmcKey,
      itemClsCd: item.classificationCode,
      itemCd,
      itemTyCd: item.productTypeCode,
      itemNm: item.name,
      itemStdNm: null,
      orgnNatCd: 'KE',
      pkgUnitCd: item.packagingUnitCode,
      qtyUnitCd: item.unitCode,
      taxTyCd: item.taxTyCd,
      btchNo: null,
      bcd: item.sku ?? null,
      dftPrc: 0,
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

    const res = await deps.etimsAdapter.saveItem(request, {
      merchantId: input.merchantId,
      branchId: connection.kraBhfId,
      kraPin: connection.kraPin,
      environment: connection.environment,
      cmcKey: connection.cmcKey,
      deviceId: connection.deviceId,
    });

    const resultCd = res.rawResponse?.resultCd ?? null;
    const resultMsg = res.rawResponse?.resultMsg ?? null;

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

    const updated: CatalogItem = {
      ...item,
      etimsItemCode: itemCd,
      registrationStatus: 'FAILED',
      lastSyncAttemptAt: now,
      lastSyncResultCd: resultCd,
      lastSyncResultMsg: resultMsg,
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
