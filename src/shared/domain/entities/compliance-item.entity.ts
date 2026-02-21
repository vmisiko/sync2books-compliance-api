import { ItemType } from '../enums/item-type.enum';
import { TaxCategory } from '../enums/tax-category.enum';

/**
 * Compliance item - registered goods/services.
 * Versioning is critical for audit (lines snapshot at creation time).
 */
export interface ComplianceItem {
  id: string;
  merchantId: string;
  name: string;
  sku: string | null;
  itemType: ItemType;
  taxCategory: TaxCategory;
  classificationCode: string;
  /** OSCU unit of quantity code (qtyUnitCd) */
  unitCode: string;
  /** OSCU packaging unit code (pkgUnitCd) */
  packagingUnitCode: string;
  /** OSCU tax type code (taxTyCd) */
  taxTyCd: string;
  /** OSCU product type code (itemTyCd) */
  productTypeCode: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
