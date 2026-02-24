import type { EtimsInvoicePayload } from '../mapping/etims-payload.types';
import type {
  OscuStockIOSaveReq,
  OscuStockIOSaveRes,
  OscuStockMasterSaveReq,
  OscuStockMasterSaveRes,
  OscuStockMoveReq,
  OscuStockMoveRes,
} from '../transport';

export interface EtimsSubmissionResult {
  success: boolean;
  receiptNumber?: string;
  rawResponse?: Record<string, unknown>;
  error?: string;
}

export interface IEtimsAdapter {
  submitInvoice(
    payload: EtimsInvoicePayload,
    connectionContext: {
      merchantId: string;
      branchId: string;
      kraPin: string;
      environment: 'SANDBOX' | 'PRODUCTION';
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<EtimsSubmissionResult>;

  /**
   * Stock In/Out save (`/insertStockIO`)
   * Transport-level call.
   */
  insertStockIO(
    request: OscuStockIOSaveReq,
    connectionContext: {
      merchantId: string;
      branchId: string;
      kraPin: string;
      environment: 'SANDBOX' | 'PRODUCTION';
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockIOSaveRes;
    error?: string;
  }>;

  /**
   * Stock master save (`/saveStockMaster`)
   * Transport-level call.
   */
  saveStockMaster(
    request: OscuStockMasterSaveReq,
    connectionContext: {
      merchantId: string;
      branchId: string;
      kraPin: string;
      environment: 'SANDBOX' | 'PRODUCTION';
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockMasterSaveRes;
    error?: string;
  }>;

  /**
   * Select stock movement list (`/selectStockMoveList`)
   * Transport-level call.
   */
  selectStockMoveList(
    request: OscuStockMoveReq,
    connectionContext: {
      merchantId: string;
      branchId: string;
      kraPin: string;
      environment: 'SANDBOX' | 'PRODUCTION';
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockMoveRes;
    error?: string;
  }>;
}
