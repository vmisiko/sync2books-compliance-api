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
  async submitInvoice(
    payload: EtimsInvoicePayload,
    _connectionContext: {
      merchantId: string;
      branchId: string;
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<EtimsSubmissionResult> {
    return {
      success: true,
      receiptNumber: `ETR-${Date.now()}-${payload.documentNumber}`,
      rawResponse: { receiptNumber: `ETR-${Date.now()}` },
    };
  }
}
