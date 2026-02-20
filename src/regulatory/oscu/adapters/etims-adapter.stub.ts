import type {
  EtimsSubmissionResult,
  IEtimsAdapter,
} from '../ports/etims-adapter.port';
import type { EtimsInvoicePayload } from '../mapping/etims-payload.types';

/**
 * Stub OSCU/eTIMS adapter - replace with real implementation.
 * Transport-only: auth, signatures, error normalization.
 */
export class EtimsAdapterStub implements IEtimsAdapter {
  submitInvoice(
    payload: EtimsInvoicePayload,
    _connectionContext: {
      merchantId: string;
      branchId: string;
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<EtimsSubmissionResult> {
    void _connectionContext;
    const now = Date.now();
    return Promise.resolve({
      success: true,
      receiptNumber: `ETR-${now}-${payload.documentNumber}`,
      rawResponse: { receiptNumber: `ETR-${now}` },
    });
  }
}
