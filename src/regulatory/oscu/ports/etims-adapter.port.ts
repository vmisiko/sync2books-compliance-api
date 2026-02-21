import type { EtimsInvoicePayload } from '../mapping/etims-payload.types';

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
}
