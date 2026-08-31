import type { OscuApiResponse } from '../oscu-api.types';

/**
 * `/selectSalesTransactions` response row -- every sale/credit-note this tin
 * has submitted via `saveTrnsSalesOsdc`/`sendSalesTransaction`. Field set and
 * shape confirmed against a real captured response (2026-08-31, shared
 * sandbox PIN P600004185A, 6 real sales records including a credit note).
 */
export interface OscuSalesListItem {
  itemSeq: number;
  itemCd: string;
  itemClsCd: string;
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
}

export interface OscuSalesListReceipt {
  custTin: string | null;
  custMblNo: string | null;
  rcptPbctDt: string;
  rptNo: number;
  trdeNm: string | null;
  adrs: string | null;
  topMsg: string | null;
  btmMsg: string | null;
  prchrAcptcYn: 'Y' | 'N';
  intrlData: string;
  rcptSign: string;
  curRcptNo: string;
  totRcptNo: string;
  sdcDateTime: string;
}

export interface OscuSalesListRow {
  invcNo: number;
  /** 0 for an original sale; the original sale's invcNo for a credit note. */
  orgInvcNo: number;
  custTin: string | null;
  custNm: string | null;
  /** 'S' sale, 'R' credit note (refund). */
  rcptTyCd: string;
  pmtTyCd: string;
  salesSttsCd: string;
  cfmDt: string;
  salesDt: string;
  stockRlsDt: string;
  cnclReqDt: string | null;
  cnclDt: string | null;
  rfdDt: string | null;
  rfdRsnCd: string | null;
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
  prchrAcptcYn: 'Y' | 'N';
  remark: string | null;
  regrId: string;
  regrNm: string;
  modrId: string | null;
  modrNm: string | null;
  receipt: OscuSalesListReceipt;
  itemList: OscuSalesListItem[];
}

export interface OscuSalesListData {
  salesList: OscuSalesListRow[];
}

export type OscuSalesListRes = OscuApiResponse<OscuSalesListData>;
