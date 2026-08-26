/**
 * Which strategy actually produced `classificationCode`, in the order
 * ClassificationResolverTypeOrm.resolveItemClassification tries them:
 *   - EXPLICIT: the caller already supplied classificationCode directly
 *     (e.g. a manually-created item's own form field, or an
 *     already-approved classification_mappings row resolved by the caller
 *     before calling in -- see DashboardItemsApplicationService.pullItems)
 *     -- the resolver's own lookup chain never ran.
 *   - EXTERNAL_ID: matched an active classification_mappings row keyed on
 *     this item's externalId -- the strongest signal (same ERP record).
 *   - SKU: matched on this item's sku -- an exact identifier, but less
 *     reliable than externalId (SKUs can be reused/reassigned).
 *   - NAME_CONTAINS: matched via a fuzzy ILike("%name%") lookup -- a
 *     guess, not an exact match; the weakest confirmed-match strategy.
 *   - DEFAULT: no item-specific mapping matched anything above; fell back
 *     to this merchant's single `source: 'default'` placeholder row.
 * EXTERNAL_ID/SKU/EXPLICIT are confident matches; NAME_CONTAINS/DEFAULT are
 * weak guesses that should surface for manual review (see
 * CatalogItem.needsClassificationReview).
 */
export type ClassificationMethod =
  | 'EXPLICIT'
  | 'EXTERNAL_ID'
  | 'SKU'
  | 'NAME_CONTAINS'
  | 'DEFAULT';

/**
 * Resolves internal attributes to regulator codes.
 * Uses mapping tables - never hardcode OSCU codes.
 */
export interface ClassificationResolution {
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
  source: 'merchant_override' | 'rule_based' | 'default';
  /** Which strategy actually matched classificationCode -- see ClassificationMethod. */
  method: ClassificationMethod;
}

export interface IClassificationResolver {
  resolveClassification(params: {
    merchantId: string;
    itemType: string;
    itemName?: string;
    sku?: string;
    externalId?: string;
    /**
     * The ERP this item was pulled from (e.g. 'QUICKBOOKS', 'ODOO') -- scopes
     * the externalId/SKU/name classification lookups so two ERPs that happen
     * to assign the same small numeric id (or the same free-text SKU) to
     * unrelated products don't silently inherit each other's classification.
     * Null/omitted (a manually-created item) matches only rows with no
     * sourceSystem recorded.
     */
    sourceSystem?: string | null;
    /**
     * classificationCode/unitCode/packagingUnitCode are resolved per item
     * (from that item's own classification_mappings row) by the caller and
     * passed in here — there's no category table backing them, so the
     * resolver throws if unitCode/packagingUnitCode are missing rather than
     * defaulting. taxTyCd stays optional: if omitted, it's resolved from
     * internalTaxCategory against the shared tax_mappings category table.
     */
    classificationCode?: string;
    unitCode?: string;
    packagingUnitCode?: string;
    taxTyCd?: string;
    productTypeCode?: string;
    internalTaxCategory?: string;
  }): Promise<ClassificationResolution>;
}
