import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

/**
 * Catalog item - registered goods/services.
 * Versioning is critical for audit (document lines snapshot at creation time).
 */
export interface CatalogItem {
  id: string;
  merchantId: string;
  /** Null for items created manually in the dashboard (never pulled from an ERP). */
  externalId: string | null;
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
  /** OSCU default unit price (dftPrc). Null when unknown (e.g. dropped/unset ERP source). */
  unitPrice: number | null;
  /** OSCU country of origin (orgnNatCd). Defaults to 'KE' when unset. */
  originCountry: string | null;
  /**
   * Whether this item requires KRA stock tracking (insertStockIO etc).
   * Not part of itemTyCd -- KRA's own item-type code list (cdCls 24: Raw
   * Material / Finished Product / Service) has no distinct "non-stock good"
   * value, so this is tracked as its own flag rather than folded into
   * productTypeCode. Fully derived from itemType on every register/update,
   * uniformly regardless of source (manual, QuickBooks pull, Mode A):
   * ItemType.GOODS -> true, ItemType.SERVICE -> false. No override.
   */
  isStockItem: boolean;
  registrationStatus: 'PENDING' | 'REGISTERED' | 'FAILED';
  /**
   * The eTIMS/OSCU item code (`itemCd`) assigned/managed by this system.
   * This is what must be used for sales and stock payloads.
   */
  etimsItemCode: string | null;
  /** Last attempt result code/message from OSCU, if available. */
  lastSyncResultCd: string | null;
  lastSyncResultMsg: string | null;
  /** Last sync attempt timestamp (success or failure). */
  lastSyncAttemptAt: Date | null;
  version: number;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
