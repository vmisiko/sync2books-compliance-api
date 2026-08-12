import type { OscuApiResponse, OscuRequestContext } from '../oscu-api.types';

/**
 * `/insertStockIO` (Stock In/Out Save) request.
 * Source: StockIOSaveReq/Res section in OSCU v2.0 spec.
 *
 * Transaction-level fields (regTyCd, sarTyCd, ocrnDt, custTin, totals, remark,
 * regr/modr ids) belong at the request root, not inside itemList entries --
 * confirmed empirically against the sandbox (2026-08-10): a request with these
 * only nested inside itemList[] was rejected with "regTyCd cannot be null",
 * while root-level placement (itemList entries carrying only item-specific
 * fields) succeeded with resultCd 000.
 */
export interface OscuStockIOSaveReq extends OscuRequestContext {
  /** Stored released number */
  sarNo: number;
  /**
   * Original sarNo being corrected/reversed. KRA's backend deserializes this as a
   * primitive `Integer.intValue()` -- sending `null` throws an NPE server-side and
   * (inconsistently) surfaces as anything from a specific NPE message to a vague
   * "item tax type... try again later" error, never a clean validation message.
   * Confirmed empirically 2026-08-12: use `0` when there's no original to reference,
   * never `null`.
   */
  orgSarNo: number;
  regTyCd: string;
  custTin: string | null;
  custNm: string | null;
  custBhfId: string | null;
  sarTyCd: string;
  /** Occurred date (yyyyMMdd) */
  ocrnDt: string;
  totItemCnt: number;
  totTaxblAmt: number;
  totTaxAmt: number;
  totAmt: number;
  remark: string | null;
  regrId: string;
  regrNm: string;
  modrId: string;
  modrNm: string;
  /** Stock in/out items (list) */
  itemList: Array<{
    itemSeq: number;
    itemCd: string;
    itemClsCd: string;
    itemNm: string;
    bcd: string | null;
    pkgUnitCd: string;
    pkg: number;
    qtyUnitCd: string;
    qty: number;
    itemExprDt: string | null;
    prc: number;
    splyAmt: number;
    totDcAmt: number;
    taxblAmt: number;
    taxTyCd: string;
    taxAmt: number;
    /**
     * Per-item total amount. Missing this field fails with "Expected a value for
     * totAmt on item: N but it is empty or null" -- confirmed empirically
     * 2026-08-12 via a raw curl call direct to KRA's sandbox, bypassing this
     * codebase entirely. Distinct from the request-root `totAmt` above (that one
     * is the transaction total; this one is the per-line total, same value when
     * there's exactly one line).
     */
    totAmt: number;
  }>;
}

export type OscuStockIOSaveRes = OscuApiResponse<null>;
