import type { OscuApiResponse } from '../oscu-api.types';

/**
 * `/selectCodeList` response DTOs (Code list).
 * Source: OSCU spec §3.3.2.1 CodeSearchReq/Res + JSON sample.
 *
 * Response is nested: one row per code *class* (cdCls, e.g. Tax Type,
 * Unit of Quantity), each carrying its own list of code *values* (dtlList).
 */
export interface OscuCodeDtlRow {
  cd: string;
  cdNm: string;
  cdDesc: string | null;
  useYn: 'Y' | 'N';
  srtOrd: number | null;
  userDfnCd1: string | null;
  userDfnCd2: string | null;
  userDfnCd3: string | null;
}

export interface OscuCodeClsRow {
  cdCls: string;
  cdClsNm: string;
  cdClsDesc: string | null;
  useYn: 'Y' | 'N';
  userDfnNm1: string | null;
  userDfnNm2: string | null;
  userDfnNm3: string | null;
  dtlList: OscuCodeDtlRow[];
}

export interface OscuCodeListData {
  clsList: OscuCodeClsRow[];
}

export type OscuCodeSearchRes = OscuApiResponse<OscuCodeListData>;
