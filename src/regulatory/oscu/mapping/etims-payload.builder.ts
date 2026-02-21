import { ComplianceDocument } from '../../../sales/domain/entities/compliance-document.entity';
import type {
  EtimsInvoiceLine,
  EtimsInvoicePayload,
} from './etims-payload.types';

/**
 * Transformation boundary: ComplianceDocument → eTIMS payload.
 * Mapping is regulatory-specific and must stay out of core validation rules.
 */
export class EtimsPayloadBuilder {
  static buildFromDocument(document: ComplianceDocument): EtimsInvoicePayload {
    const lines: EtimsInvoiceLine[] = document.lines.map((line) => ({
      itemCode: line.itemId,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxAmount: line.taxAmount,
      classificationCode: line.classificationCodeSnapshot,
      unitCode: line.unitCodeSnapshot,
      packagingUnitCode: line.packagingUnitCodeSnapshot ?? 'NT',
      taxTyCd: line.taxTyCdSnapshot ?? 'D',
      productTypeCode: line.productTypeCodeSnapshot ?? '2',
    }));

    const payload: EtimsInvoicePayload = {
      documentNumber: document.documentNumber,
      documentType: document.documentType,
      originalDocumentNumber: document.originalDocumentNumber ?? undefined,
      saleDate: document.saleDate ?? undefined,
      receiptTypeCode: document.receiptTypeCode ?? undefined,
      paymentTypeCode: document.paymentTypeCode ?? undefined,
      invoiceStatusCode: document.invoiceStatusCode ?? undefined,
      branchId: document.branchId,
      deviceId: '', // Filled by adapter from connection
      currency: document.currency,
      exchangeRate: document.exchangeRate,
      subtotalAmount: document.subtotalAmount,
      taxAmount: document.totalTax,
      totalAmount: document.totalAmount,
      lines,
    };

    if (document.customerPin) payload.customerPin = document.customerPin;

    return payload;
  }
}
