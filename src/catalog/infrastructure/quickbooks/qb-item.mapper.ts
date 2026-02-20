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
   * Optional override for OSCU classification code (itemClsCd).
   * In dashboard flows this typically comes from user selection or a prior mapping.
   */
  classificationCodeOverride?: string;
}): RegisterItemInput {
  const { merchantId, qbItem } = params;

  return {
    merchantId,
    externalId: qbItem.Id,
    name: qbItem.Name,
    sku: qbItem.Sku ?? null,
    itemType: mapQbItemType(qbItem.Type),
    taxCategory: mapQbTaxToInternalTaxCategory(qbItem),
    internalUnit: (qbItem.UQCDisplayText ?? 'EA').toUpperCase(),
    classificationCode: params.classificationCodeOverride,
  };
}

function mapQbItemType(type?: QuickBooksItem['Type']): ItemType {
  if (type === 'Service') return ItemType.SERVICE;
  // Inventory and NonInventory both become GOODS for our compliance catalog.
  return ItemType.GOODS;
}

function mapQbTaxToInternalTaxCategory(item: QuickBooksItem): TaxCategory {
  // QB tax config varies a lot; keep mapping conservative and overrideable by dashboard.
  const name = (item.SalesTaxCodeRef?.name ?? '').toUpperCase();

  if (name.includes('EXEMPT')) return TaxCategory.EXEMPT;
  if (name.includes('ZERO') || name.includes('0%')) return TaxCategory.VAT_ZERO;
  if (name.includes('VAT') || name.includes('STANDARD'))
    return TaxCategory.VAT_STANDARD;

  // If not present/unknown, fall back to OTHER; global tax mapping will map OTHER -> D by default.
  return TaxCategory.OTHER;
}
