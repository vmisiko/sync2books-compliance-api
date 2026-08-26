import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  computeNeedsClassificationReview,
  type CatalogItem,
} from '../../domain/entities/catalog-item.entity';
import type { ICatalogItemRepository } from '../../domain/ports/item-repository.port';
import type { IClassificationResolver } from '../../domain/ports/classification-resolver.port';
import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

export interface UpdateManualItemInput {
  itemId: string;
  merchantId: string;
  name?: string;
  sku?: string | null;
  classificationCode?: string;
  unitCode?: string;
  packagingUnitCode?: string;
  unitPrice?: number | null;
  originCountry?: string | null;
  /** Derived by the caller from productTypeCode ('3' -> SERVICE, else GOODS) -- see createItem's identical derivation. */
  itemType?: ItemType;
  /** Derived by the caller from taxTyCd via the same TAX_CATEGORY_BY_CODE map createItem uses. */
  taxCategory?: TaxCategory;
  /** Explicit OSCU tax type code (taxTyCd) -- takes precedence over deriving one from taxCategory. */
  taxTyCd?: string;
  /** Explicit OSCU product type code (itemTyCd) -- '1' Raw Material, '2' Finished Product, '3' Service. */
  productTypeCode?: string;
}

/**
 * Edits a manually-created catalog item (no `externalId`) in place, by id.
 *
 * `registerItem`'s upsert logic is keyed by `externalId` -- deliberately, since
 * that's the value an ERP pull re-supplies on every sync so the same real-world
 * item resolves to the same row (see the sourceSystem-scoping fix on that
 * function). A manually-created item has no `externalId` at all, so calling
 * `registerItem` again to "edit" one doesn't update it -- it inserts a brand
 * new row with a random id, leaving the original (still-broken) one in place.
 * This is the correct tool for that case: look the item up by its own id,
 * re-resolve only the fields being changed, and save in place.
 *
 * Not offered for ERP-sourced items -- those should be fixed at the source
 * (the ERP) or via Mapping Center's classification override, since a
 * subsequent pull would just overwrite a direct edit anyway. Not offered
 * once REGISTERED either -- that item already carries a real, permanent KRA
 * itemCd; editing its fields afterward is a resync decision, not a plain
 * "fix my draft" edit, so it's kept out of scope for this endpoint.
 */
export async function updateManualItem(
  input: UpdateManualItemInput,
  itemRepo: ICatalogItemRepository,
  classificationResolver: IClassificationResolver,
): Promise<CatalogItem> {
  const existing = await itemRepo.findById(input.itemId);
  if (!existing || existing.merchantId !== input.merchantId) {
    throw new NotFoundException(`Item ${input.itemId} not found`);
  }
  if (existing.externalId) {
    throw new BadRequestException(
      'This item was pulled from a connected ERP -- edit it there, or override its classification via Mapping Center, rather than directly.',
    );
  }
  if (existing.registrationStatus === 'REGISTERED') {
    throw new BadRequestException(
      'This item is already REGISTERED with KRA -- editing it here is only offered before first registration.',
    );
  }
  if (
    input.classificationCode === undefined &&
    input.unitCode === undefined &&
    input.packagingUnitCode === undefined &&
    input.name === undefined &&
    input.sku === undefined &&
    input.unitPrice === undefined &&
    input.originCountry === undefined &&
    input.itemType === undefined &&
    input.taxCategory === undefined &&
    input.taxTyCd === undefined &&
    input.productTypeCode === undefined
  ) {
    throw new BadRequestException('Provide at least one field to update');
  }

  const name = input.name ?? existing.name;
  const sku = input.sku !== undefined ? input.sku : existing.sku;
  const unitPrice =
    input.unitPrice !== undefined ? input.unitPrice : existing.unitPrice;
  const originCountry =
    input.originCountry !== undefined
      ? input.originCountry
      : existing.originCountry;
  const itemType = input.itemType ?? existing.itemType;
  const taxCategory = input.taxCategory ?? existing.taxCategory;
  // Stock-tracking eligibility follows itemType, same rule as registerItem.
  const isStockItem = itemType === ItemType.GOODS;

  const resolution = await classificationResolver.resolveClassification({
    merchantId: input.merchantId,
    itemType,
    itemName: name,
    sku: sku ?? undefined,
    sourceSystem: existing.sourceSystem,
    classificationCode: input.classificationCode ?? existing.classificationCode,
    unitCode: input.unitCode ?? existing.unitCode,
    packagingUnitCode: input.packagingUnitCode ?? existing.packagingUnitCode,
    taxTyCd: input.taxTyCd ?? existing.taxTyCd,
    productTypeCode: input.productTypeCode ?? existing.productTypeCode,
    internalTaxCategory: taxCategory,
  });

  const now = new Date();
  const updated: CatalogItem = {
    ...existing,
    name,
    sku,
    unitPrice,
    originCountry,
    itemType,
    taxCategory,
    isStockItem,
    classificationCode: resolution.classificationCode,
    classificationMethod: resolution.method,
    needsClassificationReview: computeNeedsClassificationReview(resolution.method),
    unitCode: resolution.unitCode,
    packagingUnitCode: resolution.packagingUnitCode,
    taxTyCd: resolution.taxTyCd,
    productTypeCode: resolution.productTypeCode,
    // Any change requires a resync to eTIMS (same itemCd can be reused) --
    // mirrors registerItem's "something changed" resync trigger.
    registrationStatus: 'PENDING',
    lastSyncedAt: null,
    lastSyncResultCd: null,
    lastSyncResultMsg: null,
    lastSyncAttemptAt: null,
    version: existing.version + 1,
    updatedAt: now,
  };

  return itemRepo.save(updated);
}
