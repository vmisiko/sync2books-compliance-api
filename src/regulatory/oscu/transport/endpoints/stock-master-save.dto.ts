import type { OscuApiResponse, OscuRequestContext } from '../oscu-api.types';

/**
 * `/saveStockMaster` request.
 * Source: StockMasterSaveReq/Res section in OSCU v2.0 spec.
 */
export interface OscuStockMasterSaveReq extends OscuRequestContext {
  itemCd: string;
  /** Remaining quantity */
  rsdQty: number;
  regrId: string;
  regrNm: string;
  modrId: string;
  modrNm: string;
}

export type OscuStockMasterSaveRes = OscuApiResponse<null>;
