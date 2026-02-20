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
  unitCode?: string;
  internalUnit?: string;
  packagingUnitCode?: string;
  taxTyCd?: string;
  productTypeCode?: string;
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
    internalUnit: input.internalUnit,
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
      version: existing.version + 1,
      updatedAt: now,
    };
    const saved = await itemRepo.save(updated);
    return { item: saved, created: false };
  }

  const newItem: CatalogItem = {
    id: `item-${input.merchantId}-${input.externalId}-${now.getTime()}`,
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
    registrationStatus: 'PENDING',
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
