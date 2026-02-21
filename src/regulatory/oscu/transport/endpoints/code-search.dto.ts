import type { OscuApiResponse } from '../oscu-api.types';

/**
 * `/selectCodeList` response DTOs (Code list).
 *
 * Note: The spec defines a generic code list per `cdCls`.
 * We model the common fields used across tables.
 */
export interface OscuCodeRow {
  cdCls: string;
  cd: string;
  cdNm: string;
  cdDesc?: string | null;
  useYn: 'Y' | 'N';
  sortOrd?: number | null;
}

export interface OscuCodeListData {
  codeList: OscuCodeRow[];
}

export type OscuCodeSearchRes = OscuApiResponse<OscuCodeListData>;
