import { CatalogItem } from '../../domain/entities/catalog-item.entity';
import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import type { ICatalogItemRepository } from '../../domain/ports/item-repository.port';
import type { IClassificationResolver } from '../../domain/ports/classification-resolver.port';

export interface RegisterItemInput {
  merchantId: string;
  externalId: string;
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
  /**
   * QuickBooks-derived stock signal for this registration attempt (not an
   * override -- always the current QB-derived value, computed fresh by the
   * mapper on every register/pull call). Ignored if the item already has a
   * stockItemOverride set; use DashboardItemsApplicationService.overrideStockItem
   * to set that. Defaults to false (not a stock item) when omitted, e.g. for
   * Mode A's direct registration path which doesn't derive this yet.
   */
  isStockItem?: boolean;
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
  const existing = await itemRepo.findByMerchantAndExternalId(
    input.merchantId,
    input.externalId,
  );

  const resolution = await classificationResolver.resolveClassification({
    merchantId: input.merchantId,
    itemType: input.itemType,
    itemName: input.name,
    sku: input.sku ?? undefined,
    externalId: input.externalId,
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
  const qbDerivedIsStockItem = input.isStockItem ?? false;
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
      // A manual override always wins over the QuickBooks-derived value.
      isStockItem: existing.stockItemOverride ?? qbDerivedIsStockItem,
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
    id: `item-${input.merchantId}-${input.externalId}`,
    merchantId: input.merchantId,
    externalId: input.externalId,
    name: input.name,
    sku: input.sku ?? null,
    itemType: input.itemType,
    taxCategory: input.taxCategory,
    classificationCode,
    unitCode,
    packagingUnitCode,
    taxTyCd,
    productTypeCode,
    isStockItem: qbDerivedIsStockItem,
    stockItemOverride: null,
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
