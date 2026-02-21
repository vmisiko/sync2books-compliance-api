import type {
  EtimsSubmissionResult,
  IEtimsAdapter,
} from '../ports/etims-adapter.port';
import type { EtimsInvoicePayload } from '../mapping/etims-payload.types';
import { OscuSalesRequestBuilder } from '../mapping/oscu-sales-request.builder';

/**
 * Stub OSCU/eTIMS adapter - replace with real implementation.
 * Transport-only: auth, signatures, error normalization.
 */
export class EtimsAdapterStub implements IEtimsAdapter {
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
  ): Promise<EtimsSubmissionResult> {
    const request = OscuSalesRequestBuilder.build({
      payload,
      tin: connectionContext.kraPin,
      bhfId: connectionContext.branchId,
      cmcKey: connectionContext.cmcKey,
    });
    const now = Date.now();
    return Promise.resolve({
      success: true,
      receiptNumber: `ETR-${now}-${payload.documentNumber}`,
      rawResponse: {
        resultCd: '000',
        resultMsg: 'It is succeeded',
        resultDt: new Date(now).toISOString(),
        data: {
          curRcptNo: String(now),
          totRcptNo: String(now),
          intrlData: 'STUB-INTRL',
          rcptSign: 'STUB-SIGN',
          sdcDateTime: String(now),
        },
        request,
      },
    });
  }
}
