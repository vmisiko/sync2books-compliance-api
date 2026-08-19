import { randomUUID } from 'crypto';
import { CatalogItem } from '../../domain/entities/catalog-item.entity';
import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import type { ICatalogItemRepository } from '../../domain/ports/item-repository.port';
import type { IClassificationResolver } from '../../domain/ports/classification-resolver.port';

export interface RegisterItemInput {
  merchantId: string;
  /** Omit/null for a manually-created item with no ERP source — always inserts rather than upserting. */
  externalId?: string | null;
  name: string;
  sku?: string | null;
  itemType: ItemType;
  taxCategory: TaxCategory;
  classificationCode?: string;
  /** This item's own KRA quantity unit code — resolved per item, no category fallback. */
  unitCode?: string;
  /** This item's own KRA packaging unit code — resolved per item, no category fallback. */
  packagingUnitCode?: string;
  taxTyCd?: string;
  productTypeCode?: string;
  /** OSCU default unit price (dftPrc). */
  unitPrice?: number | null;
  /** OSCU country of origin (orgnNatCd). Defaults to 'KE' when unset. */
  originCountry?: string | null;
}

export interface RegisterItemResult {
  item: CatalogItem;
  created: boolean;
}

/**
 * Register or update a catalog item.
 * Resolves classification/unit via mapping if not provided.
 */
export async function registerItem(
  input: RegisterItemInput,
  itemRepo: ICatalogItemRepository,
  classificationResolver: IClassificationResolver,
): Promise<RegisterItemResult> {
  // A manually-created item has no externalId -- there's nothing to upsert
  // against, so it always inserts as a brand-new row (guards against a null
  // externalId ever matching another manual item's row).
  const existing = input.externalId
    ? await itemRepo.findByMerchantAndExternalId(
        input.merchantId,
        input.externalId,
      )
    : null;

  const resolution = await classificationResolver.resolveClassification({
    merchantId: input.merchantId,
    itemType: input.itemType,
    itemName: input.name,
    sku: input.sku ?? undefined,
    externalId: input.externalId ?? undefined,
    classificationCode: input.classificationCode,
    unitCode: input.unitCode,
    packagingUnitCode: input.packagingUnitCode,
    taxTyCd: input.taxTyCd,
    productTypeCode: input.productTypeCode,
    internalTaxCategory: input.taxCategory,
  });

  const classificationCode = ensureNonEmptyString(
    resolution.classificationCode,
    'classificationCode',
  );
  const unitCode = ensureNonEmptyString(resolution.unitCode, 'unitCode');
  const packagingUnitCode = ensureNonEmptyString(
    resolution.packagingUnitCode,
    'packagingUnitCode',
  );
  const taxTyCd = ensureNonEmptyString(resolution.taxTyCd, 'taxTyCd');
  const productTypeCode = ensureNonEmptyString(
    resolution.productTypeCode,
    'productTypeCode',
  );
  // Stock-tracking eligibility is fully determined by item type -- Goods
  // (Raw Material/Finished Product) are stock-tracked, Service is not. This
  // is recomputed here on every register/update call, uniformly regardless
  // of source (manual, QuickBooks pull, or Mode A registration), and there
  // is no override mechanism.
  const isStockItem = input.itemType === ItemType.GOODS;
  const now = new Date();

  if (existing) {
    const updated: CatalogItem = {
      ...existing,
      name: input.name,
      sku: input.sku ?? existing.sku,
      itemType: input.itemType,
      taxCategory: input.taxCategory,
      classificationCode,
      unitCode,
      packagingUnitCode,
      taxTyCd,
      productTypeCode,
      unitPrice: input.unitPrice ?? existing.unitPrice,
      originCountry: input.originCountry ?? existing.originCountry ?? 'KE',
      isStockItem,
      // Any change requires a resync to eTIMS (same itemCd can be reused).
      registrationStatus: 'PENDING',
      lastSyncedAt: null,
      lastSyncResultCd: null,
      lastSyncResultMsg: null,
      lastSyncAttemptAt: null,
      version: existing.version + 1,
      updatedAt: now,
    };
    const saved = await itemRepo.save(updated);
    return { item: saved, created: false };
  }

  const newItem: CatalogItem = {
    // Stable id so other systems (sales, ERP sync) can reference it reliably.
    // Manual entries (no externalId) get a random suffix instead, since
    // there's no ERP-provided id to key off of.
    id: input.externalId
      ? `item-${input.merchantId}-${input.externalId}`
      : `item-${input.merchantId}-manual-${randomUUID()}`,
    merchantId: input.merchantId,
    externalId: input.externalId ?? null,
    name: input.name,
    sku: input.sku ?? null,
    itemType: input.itemType,
    taxCategory: input.taxCategory,
    classificationCode,
    unitCode,
    packagingUnitCode,
    taxTyCd,
    productTypeCode,
    unitPrice: input.unitPrice ?? null,
    originCountry: input.originCountry ?? 'KE',
    isStockItem,
    registrationStatus: 'PENDING',
    etimsItemCode: null,
    lastSyncResultCd: null,
    lastSyncResultMsg: null,
    lastSyncAttemptAt: null,
    version: 1,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const saved = await itemRepo.save(newItem);
  return { item: saved, created: true };
}

function ensureNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ${field} from classification resolver`);
  }
  return value;
}
