import { ComplianceLine } from '../../domain/entities/compliance-line.entity';
import { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import { generateIdempotencyKey } from '../../domain/utils/idempotency.util';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';
import type {
  IComplianceDocumentRepository,
  IComplianceEventRepository,
  IComplianceItemRepository,
} from '../../../shared/ports/repository.port';

export interface CreateDocumentInput {
  merchantId: string;
  branchId: string;
  sourceSystem: SourceSystem;
  sourceDocumentId: string;
  documentType: DocumentType;
  documentNumber: string;
  saleDate?: string | null;
  receiptTypeCode?: string | null;
  paymentTypeCode?: string | null;
  invoiceStatusCode?: string | null;
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
    /** Optional overrides; normally server snapshots from the referenced item. */
    classificationCodeSnapshot?: string;
    unitCodeSnapshot?: string;
    packagingUnitCodeSnapshot?: string;
    taxTyCdSnapshot?: string;
    productTypeCodeSnapshot?: string;
  }>;
}

export interface CreateDocumentResult {
  document: ComplianceDocument;
  created: boolean;
}

export async function createDocument(
  input: CreateDocumentInput,
  documentRepo: IComplianceDocumentRepository,
  itemRepo: IComplianceItemRepository,
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

  const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
  const items = await itemRepo.findByIds(itemIds);
  const itemsById = new Map(items.map((i) => [i.id, i]));

  const lines: ComplianceLine[] = input.lines.map((l, i) => {
    const item = itemsById.get(l.itemId);
    if (!item) {
      throw new Error(`Item ${l.itemId} not found while creating document`);
    }

    return {
      id: lineIds[i],
      documentId: '',
      itemId: l.itemId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxCategory: l.taxCategory as ComplianceLine['taxCategory'],
      taxAmount: l.taxAmount,
      classificationCodeSnapshot:
        l.classificationCodeSnapshot &&
        l.classificationCodeSnapshot.trim() !== ''
          ? l.classificationCodeSnapshot
          : item.classificationCode,
      unitCodeSnapshot:
        l.unitCodeSnapshot && l.unitCodeSnapshot.trim() !== ''
          ? l.unitCodeSnapshot
          : item.unitCode,
      packagingUnitCodeSnapshot:
        l.packagingUnitCodeSnapshot ?? item.packagingUnitCode,
      taxTyCdSnapshot: l.taxTyCdSnapshot ?? item.taxTyCd,
      productTypeCodeSnapshot:
        l.productTypeCodeSnapshot ?? item.productTypeCode,
      createdAt: now,
    };
  });

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
    saleDate: input.saleDate ?? null,
    receiptTypeCode: input.receiptTypeCode ?? null,
    paymentTypeCode: input.paymentTypeCode ?? null,
    invoiceStatusCode: input.invoiceStatusCode ?? null,
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
