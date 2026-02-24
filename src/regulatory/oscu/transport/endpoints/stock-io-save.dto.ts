import type { OscuApiResponse, OscuRequestContext } from '../oscu-api.types';

/**
 * `/insertStockIO` (Stock In/Out Save) request.
 * Source: StockIOSaveReq/Res section in OSCU v2.0 spec.
 *
 * Note: Spec includes many monetary fields marked required. This DTO models
 * the transport shape, but your domain mapping may choose to populate with
 * best-available values.
 */
export interface OscuStockIOSaveReq extends OscuRequestContext {
  /** Stored released number */
  sarNo: number;
  /** Stock in/out items (list) */
  itemList: Array<{
    orgSarNo: number | null;
    regTyCd: string;
    custTin: string | null;
    custNm: string | null;
    custBhfId: string | null;
    sarTyCd: string;
    /** Occurred date time (yyyyMMddhhmmss) */
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
