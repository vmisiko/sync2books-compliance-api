import { BadRequestException } from '@nestjs/common';
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
 * Only maps what the ERP's own signal actually, unambiguously tells us.
 * `Service` is confident -- KRA's itemTyCd '3'. `Inventory`/`NonInventory` is
 * an accounting distinction (stock-tracked vs not), NOT the same axis as
 * KRA's Raw Material vs Finished Product split -- no ERP here has any
 * concept of that distinction, so guessing between '1' and '2' would be
 * fabricating data KRA requires a human to actually decide. Returns
 * undefined (product type left unset, needsProductType true) for anything
 * that isn't unambiguously a service, same as a fresh manual entry with
 * nothing selected yet.
 */
function deriveProductTypeCode(
  itemType: MainApiStandardizedItemType,
): string | undefined {
  return itemType === 'Service' ? '3' : undefined;
}

export function mapMainApiItemToRegisterItemInput(params: {
  merchantId: string;
  item: MainApiPulledItem;
  /** Resolved by the caller via MappingSuggestionService.suggestTaxCodeMapping — see DashboardItemsApplicationService.pullItems. */
  taxCategory: TaxCategory;
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
    productTypeCode: deriveProductTypeCode(item.itemType),
    taxCategory: params.taxCategory,
    // classificationCode/unitCode/packagingUnitCode are deliberately omitted
    // here -- no ERP tells us these, and register-item.usecase.ts's
    // existing-preferring fallback means omitting them is safe for both a
    // brand new item (lands PENDING with needsClassificationMapping true,
    // fixed once in Item Sync) and an existing one (a re-pull never erases
    // what a human already set there -- see that fallback's doc comment for
    // the incident this fixed).
    // Main API's Item.unitPrice is a MySQL `decimal` column -- TypeORM/mysql2
    // serialize decimal columns as strings over the wire to avoid float
    // precision loss, despite MainApiItem's own TS type claiming `number`.
    // Coerced here (not left for the caller to notice) so a downstream
    // string-vs-number comparison (e.g. registerItem's unchanged-item check)
    // doesn't see every re-pull as "changed" purely from the type mismatch.
    unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
  };
}
