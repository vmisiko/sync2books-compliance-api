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
  });

  const classificationCode =
    input.classificationCode ?? resolution.classificationCode;
  const unitCode = input.unitCode ?? resolution.unitCode;
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
    registrationStatus: 'PENDING',
    version: 1,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const saved = await itemRepo.save(newItem);
  return { item: saved, created: true };
}
