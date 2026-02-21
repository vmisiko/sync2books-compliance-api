/**
 * OSCU/eTIMS transport-layer DTOs (raw regulator shapes).
 *
 * Source: `OSCU_Specification_Document_v2.0` (Request/Response object definitions + JSON samples).
 */

export type OscuResultCd = string;

/**
 * Common OSCU response envelope.
 * Many endpoints return `data: null` even on success.
 */
export interface OscuApiResponse<TData> {
  /** Response code (e.g. "000" success). See API Response Code table in the spec. */
  resultCd: OscuResultCd;
  /** Human message */
  resultMsg: string;
  /** Response datetime string (often `yyyyMMddhhmmss`) */
  resultDt: string;
  /** Endpoint-specific payload (nullable) */
  data: TData | null;
}

/** Common request fields (most write APIs include these). */
export interface OscuRequestContext {
  tin: string;
  bhfId: string;
  cmcKey: string;
}
