/**
 * A sale-level tax treatment, chosen when the customer is tax-exempt.
 *
 * Distinct from `TaxCategory` on a line: a line's own `taxCategory` (e.g.
 * VAT_STANDARD from its catalog price) is what the item normally sells at.
 * `InvoiceType.EXEMPT` is a whole-document override applied at sale time --
 * "sell this specific customer everything at 0% because they hold a KRA tax
 * exemption" -- without changing the item's own catalog tax category for
 * every other customer who buys it. See `applyInvoiceTypeOverride`.
 */
export enum InvoiceType {
  NORMAL = 'NORMAL',
  EXEMPT = 'EXEMPT',
}

export const ALL_INVOICE_TYPES: InvoiceType[] = Object.values(InvoiceType);

export function isInvoiceType(value: unknown): value is InvoiceType {
  return (
    typeof value === 'string' &&
    (ALL_INVOICE_TYPES as string[]).includes(value)
  );
}
