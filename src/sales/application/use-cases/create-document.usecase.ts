import { ComplianceLine } from '../../domain/entities/compliance-line.entity';
import { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import { generateIdempotencyKey } from '../../domain/utils/idempotency.util';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';
import type {
  IComplianceDocumentRepository,
  IComplianceEventRepository,
} from '../../../shared/ports/repository.port';

export interface CreateDocumentInput {
  merchantId: string;
  branchId: string;
  sourceSystem: SourceSystem;
  sourceDocumentId: string;
  documentType: DocumentType;
  documentNumber: string;
  currency: string;
  exchangeRate: number;
  subtotalAmount: number;
  totalTax: number;
  totalAmount: number;
  customerPin?: string | null;
  lines: Array<{
    itemId: string;
    description: string;
    quantity: number;
    unitPrice: number;
    taxCategory: string;
    taxAmount: number;
    classificationCodeSnapshot: string;
    unitCodeSnapshot: string;
  }>;
}

export interface CreateDocumentResult {
  document: ComplianceDocument;
  created: boolean;
}

export async function createDocument(
  input: CreateDocumentInput,
  documentRepo: IComplianceDocumentRepository,
  eventRepo?: IComplianceEventRepository,
): Promise<CreateDocumentResult> {
  const idempotencyKey = generateIdempotencyKey(
    input.merchantId,
    input.sourceDocumentId,
    input.documentType,
  );

  const existing = await documentRepo.findByIdempotencyKey(idempotencyKey);
  if (existing) return { document: existing, created: false };

  const now = new Date();
  const lineIds = input.lines.map((_, i) => `${idempotencyKey}-line-${i}`);

  const lines: ComplianceLine[] = input.lines.map((l, i) => ({
    id: lineIds[i],
    documentId: '',
    itemId: l.itemId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    taxCategory: l.taxCategory as ComplianceLine['taxCategory'],
    taxAmount: l.taxAmount,
    classificationCodeSnapshot: l.classificationCodeSnapshot,
    unitCodeSnapshot: l.unitCodeSnapshot,
    createdAt: now,
  }));

  const documentId = `doc-${idempotencyKey}-${now.getTime()}`;
  lines.forEach((l) => ((l as { documentId: string }).documentId = documentId));

  const document: ComplianceDocument = {
    id: documentId,
    merchantId: input.merchantId,
    branchId: input.branchId,
    sourceSystem: input.sourceSystem,
    sourceDocumentId: input.sourceDocumentId,
    documentType: input.documentType,
    documentNumber: input.documentNumber,
    currency: input.currency,
    exchangeRate: input.exchangeRate,
    subtotalAmount: input.subtotalAmount,
    totalAmount: input.totalAmount,
    totalTax: input.totalTax,
    customerPin: input.customerPin ?? null,
    complianceStatus: ComplianceStatus.DRAFT,
    submissionAttempts: 0,
    etimsReceiptNumber: null,
    idempotencyKey,
    createdAt: now,
    submittedAt: null,
    lines,
  };

  const saved = await documentRepo.save(document);
  if (eventRepo) {
    await eventRepo.append({
      id: `evt-${saved.id}-created-${Date.now()}`,
      documentId: saved.id,
      eventType: 'DOCUMENT_CREATED',
      payloadSnapshot: { sourceDocumentId: input.sourceDocumentId },
      responseSnapshot: null,
      createdAt: new Date(),
    });
  }

  return { document: saved, created: true };
}
