import type { EtimsInvoicePayload } from '../mapping/etims-payload.types';
import type { OscuEnvelopeResponse } from '../transport';
import type {
  OscuItemSaveReq,
  OscuItemSaveRes,
  OscuStockIOSaveReq,
  OscuStockIOSaveRes,
  OscuStockMasterSaveReq,
  OscuStockMasterSaveRes,
  OscuStockMoveReq,
  OscuStockMoveRes,
} from '../transport';

/** Passed on every OSCU HTTP call (domain connection + optional Apigee integrator credentials). */
export type EtimsConnectionContext = {
  merchantId: string;
  branchId: string;
  kraPin: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  cmcKey: string;
  deviceId: string;
  /** Postman `apigee_app_id` header — required on integrator gateway. */
  apigeeAppId?: string;
  /** Bearer token from `https://…/v1/token/generate?grant_type=client_credentials`. */
  bearerAccessToken?: string;
  /**
   * Slade360 `X-Workstation` header — per their docs "the workstation ID of the
   * user", a session-level concept rather than a branch id. Falls back to the
   * adapter's configured default when unset; only meaningful to `EtimsAdapterSlade360`.
   */
  workstationId?: string;
};

export interface EtimsSubmissionResult {
  success: boolean;
  receiptNumber?: string;
  rawResponse?: Record<string, unknown>;
  error?: string;
}

/**
 * eTIMS/OSCU adapter — core submission plus Postman “eTIMS-OSCU-Integrator” endpoints.
 * Raw JSON methods pass bodies through unchanged (Postman often keeps `tin`/`bhfId` in body as well as headers).
 */
export interface IEtimsAdapter {
  submitInvoice(
    payload: EtimsInvoicePayload,
    connectionContext: EtimsConnectionContext,
  ): Promise<EtimsSubmissionResult>;

  saveItem(
    request: OscuItemSaveReq,
    connectionContext: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuItemSaveRes;
    error?: string;
  }>;

  insertStockIO(
    request: OscuStockIOSaveReq,
    connectionContext: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockIOSaveRes;
    error?: string;
  }>;

  saveStockMaster(
    request: OscuStockMasterSaveReq,
    connectionContext: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockMasterSaveRes;
    error?: string;
  }>;

  selectStockMoveList(
    request: OscuStockMoveReq,
    connectionContext: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockMoveRes;
    error?: string;
  }>;

  // --- Postman: Branch Information Management ---

  branchInsuranceInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  branchUserAccount(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  branchSendCustomerInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  // --- Postman: Data Management ---

  branchList(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  selectCodeList(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  customerPinInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  /** `/selectCustomerList` — customer records previously sent via `branchSendCustomerInfo`. */
  selectCustomerList(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  /** `/selectItemClsList` — paged item classification reference list (`ItemClsSearchReq/Res`). */
  selectItemClsList(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  selectTaxpayerInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  selectNoticeList(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  // --- Postman: Imports ---

  importedItemInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  importedItemConvertedInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  // --- Postman: Initialization ---

  initializeOscu(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  // --- Postman: Item Management (extra) ---

  getItemInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  saveItemComposition(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  // --- Postman: Purchase ---

  getPurchaseTransactionInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  sendPurchaseTransactionInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  // --- Postman: Sales (queries) ---

  selectInvoiceDetail(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;

  selectSalesTransactions(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse>;
}
