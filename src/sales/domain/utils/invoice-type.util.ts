import { InvoiceType } from '../../../shared/domain/enums/invoice-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

/** KRA's own OSCU tax-type code for EXEMPT (cdCls '04'), confirmed against the code list: "A-Exempt". */
const OSCU_EXEMPT_TAX_TYPE_CODE = 'A';

/**
 * A sale line as far as tax treatment is concerned -- the subset every
 * caller's line-building code already has before it hands lines to
 * `createDocument`.
 */
export interface TaxableLine {
  taxCategory: string;
  taxAmount: number;
  /**
   * Optional even here: most callers never set it and let it default from
   * the catalog item (see `create-document.usecase.ts`'s
   * `taxTyCdSnapshot: l.taxTyCdSnapshot ?? item.taxTyCd`). `taxCategory`
   * alone does NOT reach KRA or the receipt -- `taxTyCdSnapshot` does
   * (`etims-payload.builder.ts` maps `taxTyCd: line.taxTyCdSnapshot ?? 'D'`),
   * which is exactly why this override has to set both.
   */
  taxTyCdSnapshot?: string;
}

/**
 * Forces every line to EXEMPT (0% VAT) when the sale is for a tax-exempt
 * customer, overriding whatever `taxCategory`/`taxAmount` the caller computed
 * from the item's own catalog price.
 *
 * Deliberately a server-side override, not a client-side convenience: the
 * dashboard's own "Invoice Type" toggle already zeroes tax client-side, but
 * nothing stops a caller of the same route (a bug, a stale cached price, a
 * future integration) from sending EXEMPT with a nonzero taxAmount. This is
 * the one place both `DashboardSalesController` and `ApiSalesController` run
 * every line through before computing subtotal/tax/total, so the numbers
 * KRA receives can never disagree with the invoice type the sale was filed
 * under -- the same reasoning as never trusting a caller's own tax math
 * elsewhere in this codebase (see `runTaxRules`'s EXEMPT check, which this
 * keeps satisfied by construction).
 *
 * Sets `taxTyCdSnapshot` alongside `taxCategory`, not `taxCategory` alone --
 * without it, the item's own catalog `taxTyCd` (e.g. 'B', 16%) keeps winning
 * downstream regardless of `taxCategory`, so KRA would still be charged the
 * item's normal rate. Confirmed live 2026-09-28: a first version of this
 * function that only overrode `taxCategory`/`taxAmount` produced a document
 * correctly flagged `invoiceType: EXEMPT`, but the actual submitted line kept
 * `taxTypeCode: 'B'` and real VAT, because
 * `taxTyCdSnapshot: l.taxTyCdSnapshot ?? item.taxTyCd` fell through to the
 * item every time this override left `taxTyCdSnapshot` unset.
 */
export function applyInvoiceTypeOverride<T extends TaxableLine>(
  lines: T[],
  invoiceType: InvoiceType,
): Array<T & Pick<Required<TaxableLine>, 'taxTyCdSnapshot'>> {
  if (invoiceType !== InvoiceType.EXEMPT) {
    // NORMAL: `taxTyCdSnapshot` stays whatever the caller already had --
    // usually unset, so create-document.usecase.ts falls back to the
    // catalog item's own code, same as before this feature existed.
    return lines as Array<T & Pick<Required<TaxableLine>, 'taxTyCdSnapshot'>>;
  }
  return lines.map((line) => ({
    ...line,
    taxCategory: TaxCategory.EXEMPT,
    taxAmount: 0,
    taxTyCdSnapshot: OSCU_EXEMPT_TAX_TYPE_CODE,
  }));
}

/** The part of a catalog item this module needs to resolve its classification's own KRA tax type. */
export interface ItemPendingExemptCheck {
  id: string;
  name: string;
  /** `CatalogItem.classificationCode` -- KRA's `itemClsCd`. Empty string means unresolved (never registered). */
  classificationCode: string;
}

/**
 * Which of KRA's own tax types a classification code carries, as returned in
 * `selectItemClsList` and mirrored verbatim onto `oscu_item_classifications`
 * (see `sync-item-classifications.usecase.ts`) -- never computed locally.
 */
export interface ClassificationTaxType {
  itemClsCd: string;
  taxTyCd: string | null;
}

/**
 * Items on an EXEMPT sale whose KRA item classification is known to carry a
 * tax type other than Exempt.
 *
 * Corrected 2026-09-28 after a real counter-example (a competing eTIMS
 * integrator successfully selling the same item both at its normal rate and,
 * shortly after, as Exempt): the first version of this check compared the
 * *item's own locally-stored* `taxTyCd` (a merchant-chosen default) against
 * Exempt, which is the wrong field. Live evidence instead correlates with the
 * item's **classification's own KRA-defined tax type**
 * (`oscu_item_classifications.taxTyCd`, KRA's own reference data, not ours):
 * an item classified "Goats" (KRA taxTyCd `B`) was rejected when sold as
 * Exempt ("You created this item with TaxTyCd: B but selling it with: A");
 * an item classified "Live Plant and Animal Material..." (KRA taxTyCd `A`)
 * was accepted -- regardless of what either item's own local `taxTyCd`
 * column said. KRA evidently validates against the classification, which can
 * legitimately allow Exempt for one item and not another sharing the same
 * merchant-assigned local tax category, matching what the counter-example
 * showed.
 *
 * This is still not a fully proven rule -- two live data points plus one
 * outside example -- so it only refuses when we hold positive KRA evidence
 * (a synced classification whose `taxTyCd` names something other than
 * Exempt). An item whose classification never synced, or whose classification
 * itself carries no tax type, is let through rather than guessed at: KRA's
 * own `sendSalesTransaction` response is authoritative either way, and a
 * false refusal blocks a legitimate sale for no benefit, whereas a rare false
 * accept costs one submission KRA can still reject on its own.
 */
export function findItemsIneligibleForExempt(
  items: ItemPendingExemptCheck[],
  classificationsByCode: Map<string, ClassificationTaxType>,
): ItemPendingExemptCheck[] {
  return items.filter((item) => {
    const classification = item.classificationCode
      ? classificationsByCode.get(item.classificationCode)
      : undefined;
    if (!classification?.taxTyCd) return false; // no positive evidence -- let KRA decide
    return classification.taxTyCd !== OSCU_EXEMPT_TAX_TYPE_CODE;
  });
}
