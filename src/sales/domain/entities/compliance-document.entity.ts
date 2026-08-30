import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';
import { ComplianceLine } from './compliance-line.entity';

/**
 * Aggregate root - the most important entity.
 * Everything revolves around this.
 *
 * This is NOT an ERP invoice.
 * This is NOT an eTIMS payload.
 * This is our internal compliance representation.
 */
export interface ComplianceDocument {
  id: string;
  merchantId: string;
  branchId: string;
  sourceSystem: SourceSystem;
  sourceDocumentId: string;
  documentType: DocumentType;
  documentNumber: string;
  /**
   * For CREDIT_NOTE: the original sale's trader invoice number (trdInvcNo).
   * Used to populate OSCU `orgInvcNo` (parsed numeric portion).
   */
  originalDocumentNumber: string | null;
  /**
   * For CREDIT_NOTE created from an internal sale: the original sale document id.
   * Used for reporting/UI linkage (not sent to OSCU).
   */
  originalSaleId: string | null;
  /**
   * Main-API `Invoice` id this document was created from, when it originated
   * from a pulled ERP invoice (see `DashboardInvoicesApplicationService.
   * createSaleFromInvoice`). Null for documents created directly (manual
   * dashboard/API entry). Carried through to the outbound OSCU-outcome
   * callback so Main API can link the callback back to its `Invoice` row.
   */
  sourceInvoiceId: string | null;
  /**
   * Main API `sync_item` id returned by `POST /internal/compliance/invoice-receipt`
   * after this document notifies Main API of a successful eTIMS submission
   * (see `DashboardInvoicesApplicationService.createSaleFromInvoice`'s
   * unconditional notification call). Null until that call succeeds. Used by
   * the dashboard's receipt-attachment-status/retry-receipt-attachment proxy
   * routes to look up/retry the sync item on Main API.
   */
  mainApiSyncItemId: string | null;
  /** Main API `sync_batch` id returned alongside `mainApiSyncItemId`, kept for completeness. */
  mainApiSyncBatchId: string | null;
  /**
   * Cached copy of the Main API sync_item's own `status` (pending/syncing/synced/failed/
   * skipped) for the eTIMS receipt-attachment push -- refreshed opportunistically whenever
   * `notifyMainApiOfReceipt` first records a status, or the dashboard's receipt-attachment-
   * status route does a live check. Lets the sales list show an "ERP Sync" column without a
   * per-row Main API call; the detail view still fetches live for the authoritative value.
   */
  attachmentSyncStatus: string | null;
  /** Latest `syncErrorMessage` from the same Main API sync_item, cached alongside the status. */
  attachmentSyncError: string | null;
  /**
   * For CREDIT_NOTE: credit note datetime (OSCU `rfdDt`) formatted as `yyyyMMddhhmmss`.
   * Optional per spec.
   */
  creditNoteDate: string | null;
  /**
   * For CREDIT_NOTE: credit note reason code (OSCU `rfdRsnCd`), e.g. "01".."06".
   * Optional per spec.
   */
  creditNoteReasonCode: string | null;
  /** Optional sales metadata for OSCU */
  saleDate: string | null;
  receiptTypeCode: string | null;
  paymentTypeCode: string | null;
  invoiceStatusCode: string | null;
  currency: string;
  exchangeRate: number;
  subtotalAmount: number;
  totalAmount: number;
  totalTax: number;
  customerPin: string | null;
  /** Snapshot at sale time of the referenced Customer, if one was selected. */
  customerId: string | null;
  customerName: string | null;
  customerPhoneNumber: string | null;
  customerEmail: string | null;
  complianceStatus: ComplianceStatus;
  submissionAttempts: number;
  etimsReceiptNumber: string | null;
  /**
   * OSCU `invcNo` -- persistent, strictly-incrementing-from-1 sequence per
   * (kraPin, environment), allocated on first submission and reused on retry.
   * Null until first submitDocument() call.
   */
  oscuInvcNo: number | null;
  idempotencyKey: string;
  createdAt: Date;
  submittedAt: Date | null;
  lines: ComplianceLine[];
}
