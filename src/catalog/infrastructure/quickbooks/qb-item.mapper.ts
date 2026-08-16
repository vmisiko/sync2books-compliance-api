import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import type { RegisterItemInput } from '../../application/use-cases/register-item.usecase';

export interface QuickBooksRef {
  value: string;
  name?: string;
}

/**
 * Minimal QuickBooks Item shape for import mapping.
 * Intentionally not exhaustive; add fields as needed per region/accounting setup.
 */
export interface QuickBooksItem {
  Id: string;
  Name: string;
  Type?: 'Inventory' | 'Service' | 'NonInventory';
  Sku?: string;
  Description?: string;
  Active?: boolean;
  SalesTaxCodeRef?: QuickBooksRef;
  UQCDisplayText?: string;
}

export function mapQuickBooksItemToRegisterItemInput(params: {
  merchantId: string;
  qbItem: QuickBooksItem;
  /**
   * Optional overrides for this specific item's OSCU codes — classification,
   * quantity unit, and packaging unit are all resolved per item (from that
   * item's own classification_mappings row, looked up by the caller) rather
   * than derived from the raw QuickBooks item here. No category/bucket step
   * happens in this mapper anymore.
   */
  classificationCodeOverride?: string;
  qtyUnitCdOverride?: string;
  packagingUnitCdOverride?: string;
}): RegisterItemInput {
  const { merchantId, qbItem } = params;

  return {
    merchantId,
    externalId: qbItem.Id,
    name: qbItem.Name,
    sku: qbItem.Sku ?? null,
    itemType: mapQbItemType(qbItem.Type),
    taxCategory: mapQbTaxToInternalTaxCategory(qbItem),
    classificationCode: params.classificationCodeOverride,
    unitCode: params.qtyUnitCdOverride,
    packagingUnitCode: params.packagingUnitCdOverride,
    isStockItem: mapQbItemToIsStockItem(qbItem.Type),
  };
}

function mapQbItemType(type?: QuickBooksItem['Type']): ItemType {
  if (type === 'Service') return ItemType.SERVICE;
  // Inventory and NonInventory both become GOODS for our compliance catalog.
  return ItemType.GOODS;
}

/**
 * KRA's own itemTyCd code list (cdCls 24: Raw Material/Finished Product/
 * Service) has no distinct "non-stock good" value, so stock-tracking
 * eligibility is tracked as its own flag rather than folded into
 * productTypeCode. QuickBooks' Type is the only real signal available here
 * -- `trackQtyOnHand` looks like a more precise fit by name, but it isn't
 * actually persisted or exposed anywhere in the main API's item pipeline
 * (checked 2026-08-15: no DB column, dropped before the item ever reaches
 * this mapper), so it can't be used.
 */
function mapQbItemToIsStockItem(type?: QuickBooksItem['Type']): boolean {
  return type === 'Inventory';
}

/**
 * Exported so callers that need to know an item's resolved internalTaxCategory
 * without registering it (e.g. the Mapping Center's classification review, to
 * show whether this item's tax dimension will actually resolve at
 * registration time) can reuse the exact same heuristic registration uses,
 * instead of re-deriving it and risking drift.
 */
export function mapQbTaxToInternalTaxCategory(item: QuickBooksItem): TaxCategory {
  // QB tax config varies a lot; keep mapping conservative and overrideable by dashboard.
  const name = (item.SalesTaxCodeRef?.name ?? '').toUpperCase();

  if (name.includes('EXEMPT')) return TaxCategory.EXEMPT;
  if (name.includes('ZERO') || name.includes('0%')) return TaxCategory.VAT_ZERO;
  if (name.includes('VAT') || name.includes('STANDARD'))
    return TaxCategory.VAT_STANDARD;

  // If not present/unknown, fall back to OTHER; global tax mapping will map OTHER -> D by default.
  return TaxCategory.OTHER;
}
