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
