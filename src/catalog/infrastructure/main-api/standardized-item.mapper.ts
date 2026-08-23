import { BadRequestException } from '@nestjs/common';
import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import type { RegisterItemInput } from '../../application/use-cases/register-item.usecase';

/**
 * Shape returned by MainApiPullClient.getItems() — see integration/main-api-pull.
 * `itemType`/`taxCategory` are sourced from the main API's `standardized` field
 * (see MainApiItem in main-api-pull.client.ts) — main API now owns all ERP-shape
 * normalization (QuickBooks Type/SalesTaxCodeRef parsing, etc.), not this repo.
 */
export interface MainApiPulledItem {
  id: string;
  itemCode: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  active: boolean;
  itemType: ItemType;
  taxCategory: TaxCategory;
  unitOfMeasure?: string | null;
  defaultTaxCodeRef?: { id: string; name?: string } | null;
  bookId?: string | null;
  bookType?: string | null;
  unitPrice?: number | null;
}

/**
 * Trivial pass-through now that main API pre-resolves itemType/taxCategory via
 * its own `standardized` field — no ERP-shape parsing happens in this repo
 * anymore (see the now-deleted qb-item.mapper.ts). Callers (e.g.
 * DashboardItemsApplicationService.pullItems) are responsible for reading
 * `item.standardized` off the raw MainApiItem and rejecting/erroring before
 * building a MainApiPulledItem if `standardized` is null (unsupported source
 * ERP) — see that call site for the explicit null check.
 */
export function mapMainApiItemToRegisterItemInput(params: {
  merchantId: string;
  item: MainApiPulledItem;
  classificationCodeOverride?: string;
  /** This item's own KRA quantity/packaging unit codes, looked up by the caller from its classification_mappings row (see DashboardItemsApplicationService.pullItems). */
  qtyUnitCdOverride?: string;
  packagingUnitCdOverride?: string;
}): RegisterItemInput {
  const { merchantId, item } = params;

  if (!item.itemType || !item.taxCategory) {
    throw new BadRequestException(
      `Item ${item.id} has no resolved itemType/taxCategory — its source ERP is not yet supported by main API's standardization layer`,
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
    itemType: item.itemType,
    taxCategory: item.taxCategory,
    classificationCode: params.classificationCodeOverride,
    unitCode: params.qtyUnitCdOverride,
    packagingUnitCode: params.packagingUnitCdOverride,
    unitPrice: item.unitPrice ?? null,
  };
}
