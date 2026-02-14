import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

/**
 * Catalog item - registered goods/services.
 * Versioning is critical for audit (document lines snapshot at creation time).
 */
export interface CatalogItem {
  id: string;
  merchantId: string;
  externalId: string;
  name: string;
  sku: string | null;
  itemType: ItemType;
  taxCategory: TaxCategory;
  classificationCode: string;
  unitCode: string;
  registrationStatus: 'PENDING' | 'REGISTERED' | 'FAILED';
  version: number;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
