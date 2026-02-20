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
     * Optional override inputs from UI/ERP. If provided, the resolver will treat
     * them as already-resolved OSCU codes and only fill missing fields.
     */
    classificationCode?: string;
    unitCode?: string;
    packagingUnitCode?: string;
    taxTyCd?: string;
    productTypeCode?: string;
    internalTaxCategory?: string;
    /** ERP/internal unit identifier (e.g. EA, PCS, EACH). */
    internalUnit?: string;
  }): Promise<ClassificationResolution>;
}
