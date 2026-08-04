import { createHash } from 'crypto';
import type { CatalogItem } from '../../domain/entities/catalog-item.entity';
import type { ICatalogItemRepository } from '../../domain/ports/item-repository.port';
import type { IComplianceConnectionRepository } from '../../../shared/ports/repository.port';
import type { IEtimsAdapter } from '../../../regulatory/oscu/ports/etims-adapter.port';
import type { OscuItemSaveReq } from '../../../regulatory/oscu/transport/endpoints/item-save.dto';

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
 * OSCU `itemCd` is not arbitrary -- KRA validates it's built from the item's own
 * registered codes. Decoded from the OSCU Postman collection's saveItem example
 * ("AO2NTBA00000005" alongside orgnNatCd="AO", itemTyCd="2", pkgUnitCd="NT",
 * qtyUnitCd="BA"): `orgnNatCd + itemTyCd + pkgUnitCd + qtyUnitCd + <8-digit seq>`.
 * Confirmed empirically: reusing a foreign itemCd whose embedded qtyUnitCd segment
 * didn't match the qtyUnitCd field sent alongside it was rejected by /insert/stockIO
 * with "Incorrect QtyUnitCd Prefix".
 *
 * The 8-digit sequence is derived deterministically from merchantId+item.id so the
 * same item always gets the same itemCd across retries (mirrors the previous
 * hash-based scheme's determinism, just now formula-compliant).
 */
function generateEtimsItemCd(item: {
  merchantId: string;
  id: string;
  productTypeCode: string;
  packagingUnitCode: string;
  unitCode: string;
}): string {
  const orgnNatCd = 'KE';
  const digest = createHash('sha256')
    .update(item.merchantId)
    .update('|')
    .update(item.id)
    .digest('hex');
  const seq = (parseInt(digest.slice(0, 8), 16) % 100_000_000)
    .toString()
    .padStart(8, '0');
  return `${orgnNatCd}${item.productTypeCode}${item.packagingUnitCode}${item.unitCode}${seq}`;
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
    const itemCd =
      normalizeNonEmptyString(item.etimsItemCode) ?? generateEtimsItemCd(item);
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
