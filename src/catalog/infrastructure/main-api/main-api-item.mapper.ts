import type { RegisterItemInput } from '../../application/use-cases/register-item.usecase';
import {
  mapQuickBooksItemToRegisterItemInput,
  type QuickBooksItem,
} from '../quickbooks/qb-item.mapper';

/** Shape returned by MainApiPullClient.getItems() — see integration/main-api-pull. */
export interface MainApiPulledItem {
  id: string;
  itemCode: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  active: boolean;
  itemType?: string | null;
  unitOfMeasure?: string | null;
  defaultTaxCodeRef?: { id: string; name?: string } | null;
  bookId?: string | null;
  bookType?: string | null;
  unitPrice?: number | null;
}

/**
 * The main API only ever sources items from QuickBooks today (see
 * item.service.ts#syncItemsFromBookkeeping), so its normalized Item shape is
 * QuickBooks-shaped (Type/SalesTaxCodeRef-equivalents). Delegates to the
 * existing QB mapper rather than duplicating the tax/type heuristics — add a
 * sibling mapper here (not a branch in this one) when a second ERP is pulled.
 */
export function mapMainApiItemToRegisterItemInput(params: {
  merchantId: string;
  item: MainApiPulledItem;
  classificationCodeOverride?: string;
  /** This item's own KRA quantity/packaging unit codes, looked up by the caller from its classification_mappings row (see DashboardItemsApplicationService.pullItems). */
  qtyUnitCdOverride?: string;
  packagingUnitCdOverride?: string;
}): RegisterItemInput {
  const { item } = params;

  // `externalId` must match InvoiceLineItem.itemRef.id from the same pull surface
  // (the raw QuickBooks item Id) so invoice lines can resolve to this catalog item later.
  const externalId = item.bookId ?? item.itemCode;

  const qbItem: QuickBooksItem = {
    Id: externalId,
    Name: item.name,
    Type: item.itemType as QuickBooksItem['Type'],
    Sku: item.sku ?? undefined,
    Description: item.description ?? undefined,
    Active: item.active,
    SalesTaxCodeRef: item.defaultTaxCodeRef
      ? { value: item.defaultTaxCodeRef.id, name: item.defaultTaxCodeRef.name }
      : undefined,
    UQCDisplayText: item.unitOfMeasure ?? undefined,
    UnitPrice: item.unitPrice ?? undefined,
  };

  return mapQuickBooksItemToRegisterItemInput({
    merchantId: params.merchantId,
    qbItem,
    classificationCodeOverride: params.classificationCodeOverride,
    qtyUnitCdOverride: params.qtyUnitCdOverride,
    packagingUnitCdOverride: params.packagingUnitCdOverride,
  });
}
