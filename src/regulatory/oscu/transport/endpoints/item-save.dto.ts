import type { OscuApiResponse, OscuRequestContext } from '../oscu-api.types';

/**
 * `/saveItem` (Item Save) request.
 * Source: ItemSaveReq/Res section + JSON sample.
 */
export interface OscuItemSaveReq extends OscuRequestContext {
  itemClsCd: string;
  itemCd: string;
  itemTyCd: string;
  itemNm: string;
  itemStdNm: string | null;
  orgnNatCd: string;
  pkgUnitCd: string;
  qtyUnitCd: string;
  taxTyCd: string;
  btchNo: string | null;
  bcd: string | null;
  dftPrc: number;
  grpPrcL1: number;
  grpPrcL2: number;
  grpPrcL3: number;
  grpPrcL4: number;
  grpPrcL5: number | null;
  addInfo: string | null;
  sftyQty: number | null;
  isrcAplcbYn: 'Y' | 'N';
  useYn: 'Y' | 'N';
  regrId: string;
  regrNm: string;
  modrId: string;
  modrNm: string;
}

/**
 * `/saveItem` response.
 * Source JSON sample shows `data: null` on success.
 */
export type OscuItemSaveRes = OscuApiResponse<null>;
