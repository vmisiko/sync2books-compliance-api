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
  /**
   * Which classification-resolver strategy actually matched
   * classificationCode -- see ClassificationMethod. Null for rows written
   * before this field existed. Recomputed on every register/update call,
   * same as isStockItem.
   */
  classificationMethod: string | null;
  /**
   * Derived from classificationMethod: true when the match was a weak guess
   * (NAME_CONTAINS fuzzy match, or the merchant's DEFAULT placeholder) or the
   * item predates this field (null) -- surfaced by GET /dashboard-api/items
   * so the dashboard can flag which pulled items actually need a human to
   * review/correct their classification. False for a confident match
   * (EXTERNAL_ID/SKU) or an EXPLICIT caller-supplied code.
   */
  needsClassificationReview: boolean;
  /** OSCU default unit price (dftPrc). Null when unknown (e.g. dropped/unset ERP source). */
  unitPrice: number | null;
  /** OSCU country of origin (orgnNatCd). Defaults to 'KE' when unset. */
  originCountry: string | null;
  /**
   * The ERP this item was pulled from (e.g. QUICKBOOKS, ODOO,
   * MICROSOFT_DYNAMICS_365_BUSINESS_CENTRAL — see SourceSystem enum), or
   * null for a manually-created item / an item pulled before this field
   * existed.
   */
  sourceSystem: string | null;
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

/**
 * classificationMethod values that reflect a weak/unconfirmed match --
 * NAME_CONTAINS is a fuzzy ILike guess, DEFAULT is the merchant's generic
 * placeholder row. Null (no recorded method -- either a row written before
 * classificationMethod existed, or resolution failed to record one) is
 * treated the same way, since there's no confidence to trust either.
 * EXTERNAL_ID/SKU are exact-identifier matches, and EXPLICIT means the code
 * was supplied directly by the caller (a manual item's own form field, or an
 * already-approved mapping) -- none of those three need a review flag.
 *
 * Single source of truth for this derivation -- used both when constructing
 * a brand-new CatalogItem (register-item.usecase.ts) and when mapping a
 * persisted row back to the domain shape (catalog-item-typeorm.repository.ts),
 * so the flag can never drift between the two paths.
 */
const WEAK_CLASSIFICATION_METHODS = new Set(['NAME_CONTAINS', 'DEFAULT']);

export function computeNeedsClassificationReview(
  classificationMethod: string | null,
): boolean {
  return (
    classificationMethod === null ||
    WEAK_CLASSIFICATION_METHODS.has(classificationMethod)
  );
}
