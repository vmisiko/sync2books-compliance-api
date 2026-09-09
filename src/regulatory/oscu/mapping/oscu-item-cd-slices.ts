/**
 * itemCd's qtyUnitCd(2)/pkgUnitCd(2) slots are a fixed-width identifier
 * component. Many legitimate KRA codes aren't exactly 2 chars ("U", "L",
 * "BLL", "CTN", ...; KRA's live /selectCodeList has no 2-char code for
 * Litre at all -- only "L" and "LTR"), so when a merchant's real code
 * doesn't fit the slot, substitute one of KRA's own 2-char codes instead of
 * failing the whole sync.
 *
 * That substitution MUST be mirrored into every request that carries
 * separate flat qtyUnitCd/pkgUnitCd fields alongside the itemCd -- they
 * can't diverge from what's embedded in itemCd. An earlier version of
 * saveItem sent the real (unsubstituted) value in those flat fields while
 * itemCd carried the fallback, on the theory (confirmed once, 2026-08-10,
 * PIN P600004123A) that KRA only validates the two independently. That's
 * since proven wrong: confirmed live 2026-09-01 against two different
 * merchants/items whose real codes were on opposite sides of 2 chars
 * (unitCode "L", 1 char, and unitCode "BLL", 3 chars) -- both were rejected
 * with the identical `400 "The ItemCd isn't made up of correct QtyUnitCd"`,
 * which only makes sense if KRA cross-checks itemCd's embedded component
 * against the flat field and rejects any mismatch. Keeping both in lockstep
 * (same fallback value in both places whenever the real code doesn't fit) is
 * what fixes it.
 *
 * This module exists because that lockstep is a property of the itemCd
 * FORMAT, not of any one endpoint. saveItem was fixed first
 * (sync-items.usecase.ts) and sendSalesTransaction was left behind for eight
 * days, silently sending the real unitCode/packagingUnitCode next to an
 * itemCd built from the substituted slices -- the exact shape KRA rejects.
 * Every caller that puts an itemCd and a flat qtyUnitCd/pkgUnitCd in the
 * same payload imports these, so the two can't drift apart again.
 */
export const QTY_UNIT_CD_SLICE_FALLBACK = 'NO'; // "Number" (cdCls 10) -- generic, always valid
export const PKG_UNIT_CD_SLICE_FALLBACK = 'NT'; // "Not applicable" (cdCls 17) -- generic, always valid

/** The 2-char value that goes in itemCd's slot -- and therefore in the flat field too. */
export function itemCdSlice(code: string, fallback: string): string {
  return code.length === 2 ? code : fallback;
}

/** itemCd-safe qtyUnitCd for a line/item whose real unit code may not be 2 chars. */
export function qtyUnitCdSlice(unitCode: string): string {
  return itemCdSlice(unitCode, QTY_UNIT_CD_SLICE_FALLBACK);
}

/** itemCd-safe pkgUnitCd for a line/item whose real packaging code may not be 2 chars. */
export function pkgUnitCdSlice(packagingUnitCode: string): string {
  return itemCdSlice(packagingUnitCode, PKG_UNIT_CD_SLICE_FALLBACK);
}
