import type { OscuApiResponse } from '../oscu-api.types';

/**
 * `/itemInfo` (KRA Go-Live "LOOK UP PRODUCT LIST", spec §3.3.3.3 ItemSearchReq/Res
 * calls it `/selectItemList`) response row -- every item this tin has ever
 * registered via `saveItem`. Field set and shape confirmed against a real
 * captured response (2026-08-31, shared sandbox PIN P600004185A, 11 real items).
 */
export interface OscuItemSearchRow {
  tin: string;
  itemCd: string;
  itemClsCd: string;
  itemTyCd: string;
  itemNm: string;
  itemStdNm: string | null;
  orgnNatCd: string;
  pkgUnitCd: string;
  qtyUnitCd: string;
  taxTyCd: string;
  btchNo: string | null;
  regBhfId: string;
  bcd: string | null;
  dftPrc: number;
  grpPrcL1: number;
  grpPrcL2: number;
  grpPrcL3: number;
  grpPrcL4: number;
  grpPrcL5: number;
  addInfo: string | null;
  sftyQty: number;
  isrcAplcbYn: 'Y' | 'N';
  rraModYn: 'Y' | 'N';
  useYn: 'Y' | 'N';
}

export interface OscuItemSearchData {
  itemList: OscuItemSearchRow[];
}

export type OscuItemSearchRes = OscuApiResponse<OscuItemSearchData>;
