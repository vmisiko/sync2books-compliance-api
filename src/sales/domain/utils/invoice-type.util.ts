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
/** The part of a catalog item this module needs to check its own registered tax type. */
export interface RegisteredItemTaxType {
  id: string;
  name: string;
  taxTyCd: string;
}

/**
 * Items on an EXEMPT sale that are NOT themselves registered with KRA under
 * the Exempt tax type -- confirmed live 2026-09-28: KRA's OSCU rejects
 * `sendSalesTransaction` outright when a line's tax type disagrees with the
 * `taxTyCd` the item was registered under via `saveItem` ("You created this
 * item with TaxTyCd: B but selling it with: A"). KRA ties tax treatment to
 * the *item as registered*, not to the transaction -- a customer's
 * exemption cannot force a normally-taxable item to file at 0%. The caller
 * (`DashboardSalesController`/`ApiSalesController`) is expected to refuse
 * the whole sale with this list rather than submit it and let KRA bounce it,
 * which would also burn a reserved `invcNo`.
 */
export function findItemsNotRegisteredExempt(
  items: RegisteredItemTaxType[],
): RegisteredItemTaxType[] {
  return items.filter((i) => i.taxTyCd !== OSCU_EXEMPT_TAX_TYPE_CODE);
}

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
