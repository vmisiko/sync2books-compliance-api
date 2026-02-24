import type { OscuApiResponse, OscuRequestContext } from '../oscu-api.types';

/**
 * `/selectStockMoveList` (Stock movement list) request.
 * Source: StockMoveReq/Res section in OSCU v2.0 spec.
 */
export interface OscuStockMoveReq extends OscuRequestContext {
  /** Last request datetime (yyyyMMddhhmmss) */
  lastReqDt: string;
}

/**
 * `/selectStockMoveList` response.
 * Spec returns a list of stock movements; we keep it as unknown records for now
 * until you decide which fields to persist.
 */
export type OscuStockMoveRes = OscuApiResponse<{
  stockMoveList?: Array<Record<string, unknown>>;
}>;
