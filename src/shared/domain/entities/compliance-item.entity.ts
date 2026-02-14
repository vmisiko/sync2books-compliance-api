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
  unitCode: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
