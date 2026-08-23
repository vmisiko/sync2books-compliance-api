import { BadRequestException } from '@nestjs/common';
import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import type { RegisterItemInput } from '../../application/use-cases/register-item.usecase';

/**
 * Main API's actual, Codat-faithful item-type vocabulary — not collapsed to a GOODS/SERVICE
 * bucket there, since that collapse is a KRA-specific simplification (KRA's item-type code list
 * has no "non-stock good" concept) that doesn't belong in a shape meant to serve any consumer.
 * This repo does its own collapse — see collapseItemType() below.
 */
export type MainApiStandardizedItemType = 'Unknown' | 'Inventory' | 'NonInventory' | 'Service';

/**
 * Shape returned by MainApiPullClient.getItems() — see integration/main-api-pull. `itemType` is
 * sourced from the main API's `standardized` field (MainApiItem.standardized.itemType in
 * main-api-pull.client.ts) — main API owns ERP-shape normalization (QuickBooks Type parsing
 * etc.), but NOT tax-authority-specific categorization; that's still this repo's job, done by
 * the caller (see DashboardItemsApplicationService.pullItems) via MappingSuggestionService
 * against `defaultTaxCodeRef.name`, and passed in as `taxCategory` below.
 */
export interface MainApiPulledItem {
  id: string;
  itemCode: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  active: boolean;
  itemType: MainApiStandardizedItemType;
  unitOfMeasure?: string | null;
  defaultTaxCodeRef?: { id: string; name?: string } | null;
  bookId?: string | null;
  bookType?: string | null;
  unitPrice?: number | null;
}

/**
 * KRA's own item-type code list has no "non-stock good" concept — Inventory and NonInventory
 * both collapse to GOODS here; only Service maps to SERVICE. Mirrors the exact behavior the
 * original (now-deleted) qb-item.mapper.ts#mapQbItemType had, just reading main API's already
 * Codat-normalized 4-value type instead of QuickBooks' raw one.
 */
function collapseItemType(itemType: MainApiStandardizedItemType): ItemType {
  return itemType === 'Service' ? ItemType.SERVICE : ItemType.GOODS;
}

export function mapMainApiItemToRegisterItemInput(params: {
  merchantId: string;
  item: MainApiPulledItem;
  /** Resolved by the caller via MappingSuggestionService.suggestTaxCodeMapping — see DashboardItemsApplicationService.pullItems. */
  taxCategory: TaxCategory;
  classificationCodeOverride?: string;
  /** This item's own KRA quantity/packaging unit codes, looked up by the caller from its classification_mappings row (see DashboardItemsApplicationService.pullItems). */
  qtyUnitCdOverride?: string;
  packagingUnitCdOverride?: string;
}): RegisterItemInput {
  const { merchantId, item } = params;

  if (!item.itemType) {
    throw new BadRequestException(
      `Item ${item.id} has no resolved itemType — its source ERP is not yet supported by main API's standardization layer`,
    );
  }

  // `externalId` must match InvoiceLineItem.itemRef.id from the same pull surface
  // (the raw ERP item id) so invoice lines can resolve to this catalog item later.
  const externalId = item.bookId ?? item.itemCode;

  return {
    merchantId,
    externalId,
    name: item.name,
    sku: item.sku ?? null,
    itemType: collapseItemType(item.itemType),
    taxCategory: params.taxCategory,
    classificationCode: params.classificationCodeOverride,
    unitCode: params.qtyUnitCdOverride,
    packagingUnitCode: params.packagingUnitCdOverride,
    unitPrice: item.unitPrice ?? null,
  };
}
