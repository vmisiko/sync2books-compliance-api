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
  orgSarNo: number | null;
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
  }>;
}

export type OscuStockIOSaveRes = OscuApiResponse<null>;
