/**
 * Which strategy actually produced `classificationCode`:
 *   - EXPLICIT: the caller supplied classificationCode directly (a manually-
 *     created item's own form field, or Item Sync's Add/Edit/Bulk Edit
 *     writing straight onto the catalog item -- see
 *     DashboardItemsApplicationService.updateItem/bulkUpdateItems).
 *   - UNRESOLVED: nothing was supplied -- classificationCode comes back ''
 *     (see CatalogItem.classificationCode) rather than throwing, so the
 *     item still registers as an incomplete, visible, fixable PENDING row
 *     (needsClassificationMapping true) instead of silently vanishing (see
 *     register-item.usecase.ts).
 * Classification is always human-supplied now -- there used to be an
 * EXTERNAL_ID/SKU/NAME_CONTAINS/DEFAULT auto-match chain here backed by a
 * `classification_mappings` table (Mapping Center's old "Classification"
 * tab), removed 2026-08-27: Item Sync's Add/Edit/Bulk Edit already write
 * classificationCode/unitCode/packagingUnitCode/productTypeCode directly
 * and immediately onto the catalog item, making that second, delayed
 * (re-pull-to-refresh), auto-matched-and-often-wrong path redundant --  and
 * it was the actual mechanism that silently overwrote 5 already-
 * KRA-REGISTERED items with blanks on a routine re-pull, because the
 * re-pull found no active mapping row and (after a since-corrected fix)
 * resolved to null instead of throwing. See
 * ITEM_MAPPING_CONSOLIDATION_PLAN.md's "classification_mappings removal"
 * section for the full incident writeup.
 */
export type ClassificationMethod = 'EXPLICIT' | 'UNRESOLVED';

/**
 * Resolves internal attributes to regulator codes.
 * Uses mapping tables - never hardcode OSCU codes.
 */
export interface ClassificationResolution {
  /** OSCU item classification code (itemClsCd), or null when the caller didn't supply one (method 'UNRESOLVED'). */
  classificationCode: string | null;
  /** OSCU unit of quantity code (qtyUnitCd), or null when the caller didn't supply one. */
  unitCode: string | null;
  /** OSCU packaging unit code (pkgUnitCd), or null when the caller didn't supply one. */
  packagingUnitCode: string | null;
  /** OSCU tax type code (taxTyCd) */
  taxTyCd: string;
  /**
   * OSCU product type code (itemTyCd) -- null when the caller didn't supply
   * one explicitly. Never inferred/guessed here (see
   * CatalogItem.productTypeCode's doc comment for why).
   */
  productTypeCode: string | null;
  source: 'merchant_override' | 'rule_based' | 'default';
  /** Which strategy actually matched classificationCode -- see ClassificationMethod. */
  method: ClassificationMethod;
}

export interface IClassificationResolver {
  resolveClassification(params: {
    merchantId: string;
    /**
     * classificationCode/unitCode/packagingUnitCode are always supplied
     * (or not) directly by the caller now -- no category table or per-item
     * lookup backs any of the three. All three simply resolve to null when
     * omitted; none of the three throw -- see ClassificationResolution's
     * doc comment and CatalogItem.needsClassificationMapping for how the
     * caller surfaces an unresolved item instead. taxTyCd stays optional
     * and DOES still throw if unresolved: if omitted, it's resolved from
     * internalTaxCategory against the shared tax_mappings category table,
     * which always has a global 'OTHER' default seeded, so an unresolved
     * taxTyCd reflects a genuinely broken merchant/global tax setup, not an
     * expected per-item gap.
     */
    classificationCode?: string;
    unitCode?: string;
    packagingUnitCode?: string;
    taxTyCd?: string;
    productTypeCode?: string;
    internalTaxCategory?: string;
  }): Promise<ClassificationResolution>;
}
