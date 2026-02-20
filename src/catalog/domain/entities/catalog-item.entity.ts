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
  /** OSCU item classification code (itemClsCd) */
  classificationCode: string;
  /** OSCU unit of quantity code (qtyUnitCd) */
  unitCode: string;
  /** OSCU packaging unit code (pkgUnitCd) */
  packagingUnitCode: string;
  /** OSCU tax type code (taxTyCd) */
  taxTyCd: string;
  /** OSCU product type code (itemTyCd) */
  productTypeCode: string;
  registrationStatus: 'PENDING' | 'REGISTERED' | 'FAILED';
  version: number;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
