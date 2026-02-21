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
  complianceStatus: ComplianceStatus;
  submissionAttempts: number;
  etimsReceiptNumber: string | null;
  idempotencyKey: string;
  createdAt: Date;
  submittedAt: Date | null;
  lines: ComplianceLine[];
}
