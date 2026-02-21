import type { OscuApiResponse, OscuRequestContext } from '../oscu-api.types';

/**
 * `/saveTrnsSalesOsdc` (Sales-transaction Save) request.
 * Source: TrnsSalesSaveWrReq/Res section in the OSCU spec.
 */
export interface OscuTrnsSalesSaveWrReq extends OscuRequestContext {
  trdInvcNo: string;
  invcNo: number;
  orgInvcNo: number;
  custTin: string | null;
  custNm: string | null;
  rcptTyCd: string;
  pmtTyCd: string;
  salesSttsCd: string;
  cfmDt: string;
  salesDt: string;
  stockRlsDt: string;
  totItemCnt: number;
  taxblAmtA: number;
  taxblAmtB: number;
  taxblAmtC: number;
  taxblAmtD: number;
  taxblAmtE: number;
  taxRtA: number;
  taxRtB: number;
  taxRtC: number;
  taxRtD: number;
  taxRtE: number;
  taxAmtA: number;
  taxAmtB: number;
  taxAmtC: number;
  taxAmtD: number;
  taxAmtE: number;
  totTaxblAmt: number;
  totTaxAmt: number;
  totAmt: number;
  remark: string | null;
  regrId: string;
  regrNm: string;
  modrId: string;
  modrNm: string;
  receipt: {
    custTin: string | null;
    custMblNo: string | null;
    rcptPbctDt: string;
    trdeNm: string | null;
    adrs: string | null;
    topMsg: string | null;
    btmMsg: string | null;
    prchrAcptcYn: 'Y' | 'N';
  };
  itemList: Array<{
    itemSeq: number;
    itemClsCd: string;
    itemCd: string;
    itemNm: string;
    bcd: string | null;
    pkgUnitCd: string;
    pkg: number;
    qtyUnitCd: string;
    qty: number;
    prc: number;
    splyAmt: number;
    dcRt: number;
    dcAmt: number;
    taxTyCd: string;
    taxblAmt: number;
    taxAmt: number;
    totAmt: number;
  }>;
}

/**
 * `/saveTrnsSalesOsdc` (Sales-transaction Save) response `data`.
 * Source: TrnsSalesSaveWrResData + JSON sample.
 */
export interface OscuTrnsSalesSaveWrResData {
  curRcptNo: string;
  totRcptNo: string;
  intrlData: string;
  rcptSign: string;
  sdcDateTime: string;
}

export type OscuTrnsSalesSaveWrRes =
  OscuApiResponse<OscuTrnsSalesSaveWrResData>;
