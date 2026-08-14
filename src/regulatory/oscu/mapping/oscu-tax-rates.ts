/**
 * OSCU tax rates by taxTyCd, confirmed live against the sandbox 2026-08-11
 * (KRA rejects `taxRtE: 8` with "Rule taxRtE failed: Tax rate mismatch. Expected: 0.00").
 * Was previously duplicated across oscu-sales-request.builder.ts, sales.service.ts,
 * and inventory.service.ts -- consolidated here so a rate never drifts out of sync
 * across call sites again.
 */
export const OSCU_TAX_RATE_BY_TAX_TY_CD: Record<string, number> = {
  A: 0,
  B: 16,
  C: 0,
  D: 0,
  E: 0,
};

export function oscuTaxRateForCode(code: string | null | undefined): number {
  if (!code) return 0;
  return OSCU_TAX_RATE_BY_TAX_TY_CD[code.toUpperCase()] ?? 0;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * KRA treats a line's total (qty * unitPrice) as tax-INCLUSIVE and derives
 * taxblAmt/taxAmt from it, rather than accepting a separately-computed
 * tax-exclusive taxblAmt with tax added on top -- confirmed for both
 * sendSalesTransaction and insertStockIO. `total` is the tax-inclusive
 * amount for the line (or the whole document, if summed first).
 */
export function splitTaxInclusiveAmount(
  total: number,
  taxTyCd: string | null | undefined,
): { taxblAmt: number; taxAmt: number } {
  const rate = oscuTaxRateForCode(taxTyCd);
  if (rate <= 0) return { taxblAmt: round2(total), taxAmt: 0 };
  const taxblAmt = round2(total / (1 + rate / 100));
  return { taxblAmt, taxAmt: round2(total - taxblAmt) };
}
