import type { OscuApiResponse } from '../oscu-api.types';

/**
 * `/selectItemClsList` response DTOs (Item classification list).
 * Source: JSON sample includes `data.itemClsList`.
 */
export interface OscuItemClassListRow {
  itemClsCd: string;
  itemClsNm: string;
  itemClsLvl: number;
  taxTyCd: string | null;
  mjrTgYn: 'Y' | 'N' | null;
  useYn: 'Y' | 'N';
}

export interface OscuItemClassListData {
  itemClsList: OscuItemClassListRow[];
}

export type OscuItemClassListRes = OscuApiResponse<OscuItemClassListData>;
