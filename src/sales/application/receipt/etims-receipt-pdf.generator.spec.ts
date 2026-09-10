import {
  generateEtimsReceiptPdf,
  dashEvery4,
  formatScuDateTime,
  type EtimsReceiptData,
  type TaxBuckets,
} from './etims-receipt-pdf.generator';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../../../shared/domain/enums/connection-status.enum';
import type { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import type { ComplianceConnection } from '../../../shared/domain/entities/compliance-connection.entity';
import type { ComplianceItem } from '../../../shared/domain/entities/compliance-item.entity';

describe('dashEvery4', () => {
  it('inserts a dash after every 4th character (TIS §6.23.6/§6.23.7)', () => {
    expect(dashEvery4('EAHSAV6ECUUXSY6PCCJYAUP6MI')).toBe(
      'EAHS-AV6E-CUUX-SY6P-CCJY-AUP6-MI',
    );
  });

  it('passes through empty input', () => {
    expect(dashEvery4('')).toBe('');
  });
});

describe('formatScuDateTime', () => {
  it('splits OSCU yyyyMMddhhmmss into dd/mm/yyyy and hh:mm:ss', () => {
    expect(formatScuDateTime('20260814110735')).toEqual({
      date: '14/08/2026',
      time: '11:07:35',
    });
  });

  it('falls back to "-" for null or malformed input', () => {
    expect(formatScuDateTime(null)).toEqual({ date: '-', time: '-' });
    expect(formatScuDateTime('202608')).toEqual({ date: '-', time: '-' });
  });
});

function zeroTaxBuckets(): TaxBuckets {
  return {
    taxableAmountA: 0,
    taxableAmountB: 0,
    taxableAmountC: 0,
    taxableAmountD: 0,
    taxableAmountE: 0,
    taxAmountA: 0,
    taxAmountB: 0,
    taxAmountC: 0,
    taxAmountD: 0,
    taxAmountE: 0,
    taxRateA: 0,
    taxRateB: 16,
    taxRateC: 0,
    taxRateD: 0,
    taxRateE: 0,
  };
}

function baseDocument(overrides: Partial<ComplianceDocument> = {}): ComplianceDocument {
  return {
    id: 'doc-1',
    merchantId: 'merchant-1',
    branchId: 'branch-1',
    sourceSystem: SourceSystem.API,
    sourceDocumentId: 'INV-1',
    documentType: DocumentType.SALE,
    documentNumber: 'INV-1',
    originalDocumentNumber: null,
    originalSaleId: null,
    sourceInvoiceId: null,
    mainApiSyncItemId: null,
    mainApiSyncBatchId: null,
    attachmentSyncStatus: null,
    attachmentSyncError: null,
    creditNoteDate: null,
    creditNoteReasonCode: null,
    saleDate: '2026-08-14',
    receiptTypeCode: 'S',
    paymentTypeCode: '01',
    invoiceStatusCode: '02',
    currency: 'KES',
    exchangeRate: 1,
    subtotalAmount: 100,
    totalAmount: 100,
    totalTax: 0,
    customerPin: null,
    customerId: null,
    customerName: 'Grace Wanjiru',
    customerPhoneNumber: null,
    customerEmail: null,
    complianceStatus: ComplianceStatus.ACCEPTED,
    submissionAttempts: 1,
    etimsReceiptNumber: '9',
    totRcptNo: '9',
    sdcDateTime: '20260814110735',
    receiptLabel: 'NS',
    oscuInvcNo: 9,
    idempotencyKey: 'idem-1',
    createdAt: new Date('2026-08-14T10:00:00Z'),
    submittedAt: new Date('2026-08-14T10:00:05Z'),
    lines: [
      {
        id: 'line-1',
        documentId: 'doc-1',
        itemId: 'item-1',
        etimsItemCodeSnapshot: 'KE2NTNO0000001',
        description: 'Milled Sorghum Flour 2kg Packet',
        quantity: 10,
        unitPrice: 240,
        taxCategory: TaxCategory.EXEMPT,
        taxAmount: 0,
        classificationCodeSnapshot: '14111400',
        unitCodeSnapshot: 'PA',
        packagingUnitCodeSnapshot: 'BG',
        taxTyCdSnapshot: 'A',
        productTypeCodeSnapshot: '2',
        createdAt: new Date('2026-08-14T10:00:00Z'),
      },
    ],
    ...overrides,
  };
}

function baseConnection(overrides: Partial<ComplianceConnection> = {}): ComplianceConnection {
  return {
    id: 'conn-1',
    merchantId: 'merchant-1',
    kraPin: 'P600004185A',
    branchId: 'branch-1',
    kraBhfId: '00',
    deviceId: '450682',
    dvcSrlNo: null,
    sdcId: 'KRACU0400001074',
    mrcNo: null,
    tradeAddressLine1: 'Waiyaki Way',
    tradeCity: 'Nairobi',
    receiptHeaderMessage: null,
    receiptFooterMessage: null,
    environment: ConnectionEnvironment.SANDBOX,
    status: ConnectionStatus.ACTIVE,
    cmcKey: 'cmc-key-1',
    lastCodeSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function baseData(overrides: Partial<EtimsReceiptData> = {}): EtimsReceiptData {
  const document = overrides.document ?? baseDocument();
  const item: ComplianceItem = {
    id: 'item-1',
    merchantId: 'merchant-1',
    name: 'Milled Sorghum Flour 2kg Packet',
    sku: null,
    taxCategory: TaxCategory.EXEMPT,
    classificationCode: '14111400',
    unitCode: 'PA',
    packagingUnitCode: 'BG',
    taxTyCd: 'A',
    productTypeCode: '2',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    document,
    connection: baseConnection(),
    itemsById: new Map([['item-1', item]]),
    receiptNumber: 9,
    receiptSignature: 'V249J39CFJ48HE2W',
    internalData: 'TE68SLA234J5EAV3N56988LJQ7',
    etimsUrl: null,
    supplierName: 'Amani Business Park Ltd',
    paymentTypeDescription: 'Cash',
    taxBuckets: zeroTaxBuckets(),
    totRcptNo: '9',
    sdcDateTime: '20260814110735',
    receiptLabel: 'NS',
    originalCuInvoiceNo: null,
    ...overrides,
  };
}

async function isValidPdf(buffer: Buffer): Promise<void> {
  expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(buffer.length).toBeGreaterThan(500);
}

describe('generateEtimsReceiptPdf', () => {
  it('renders a sale receipt with only category A used -- must not crash; all five tax rows (A-E) always print, zero by default, per the page 8 sample', async () => {
    // No text-extraction library is available in this repo to assert the rendered
    // rows directly (see the PDF-text-extraction note in this file's history) -- this
    // proves the generator survives the all-exempt case end-to-end. The "print all
    // five unconditionally" behavior itself lives in the unfiltered `buckets` array
    // in generateEtimsReceiptPdf -- confirmed against a live KRA-certified receipt.
    const buffer = await generateEtimsReceiptPdf(
      baseData({
        taxBuckets: { ...zeroTaxBuckets(), taxableAmountA: 2400, taxAmountA: 0 },
      }),
    );
    await isValidPdf(buffer);
  });

  it('renders a credit note without throwing, given an original CU invoice number', async () => {
    const creditDoc = baseDocument({
      documentType: DocumentType.CREDIT_NOTE,
      originalDocumentNumber: 'INV-1',
      originalSaleId: 'doc-original',
      receiptLabel: 'NC',
      subtotalAmount: 100,
      totalTax: 16,
      totalAmount: 116,
    });
    const buffer = await generateEtimsReceiptPdf(
      baseData({
        document: creditDoc,
        receiptLabel: 'NC',
        originalCuInvoiceNo: 'KRACU0400001074/9 NS',
        taxBuckets: {
          ...zeroTaxBuckets(),
          taxableAmountB: 100,
          taxAmountB: 16,
        },
      }),
    );
    await isValidPdf(buffer);
  });

  it('renders with a null connection (no eTIMS link yet) without throwing', async () => {
    const buffer = await generateEtimsReceiptPdf(baseData({ connection: null }));
    await isValidPdf(buffer);
  });
});
