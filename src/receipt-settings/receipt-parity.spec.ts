import * as PDFDocument from 'pdfkit';
import { generateEtimsReceiptPdf, type EtimsReceiptData } from '../sales/application/receipt/etims-receipt-pdf.generator';
import { submitDocument } from '../sales/application/use-cases/submit-document.usecase';
import { OscuSalesRequestBuilder } from '../regulatory/oscu/mapping/oscu-sales-request.builder';
import type { EtimsInvoicePayload } from '../regulatory/oscu/mapping/etims-payload.types';
import { ComplianceStatus } from '../shared/domain/enums/compliance-status.enum';
import { ConnectionEnvironment } from '../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../shared/domain/enums/connection-status.enum';
import { DocumentType } from '../shared/domain/enums/document-type.enum';
import { InvoiceType } from '../shared/domain/enums/invoice-type.enum';
import { SourceSystem } from '../shared/domain/enums/source-system.enum';
import { TaxCategory } from '../shared/domain/enums/tax-category.enum';
import type { ComplianceConnection } from '../shared/domain/entities/compliance-connection.entity';
import type { ComplianceDocument } from '../sales/domain/entities/compliance-document.entity';
import {
  applyTransmittedSnapshot,
  legacyReceiptView,
  receiptBlockTextFromView,
  resolveReceiptView,
  type ReceiptSettingsData,
} from './domain/receipt-settings.model';

const connection: ComplianceConnection = {
  id: 'conn-1', merchantId: 'm-1', kraPin: 'P600004185A', branchId: 'branch-1', kraBhfId: '00',
  deviceId: '450682', dvcSrlNo: null, sdcId: 'KRACU0400001074', mrcNo: null,
  tradeAddressLine1: 'Jamhuri, Langata District', tradeCity: 'Nairobi',
  receiptHeaderMessage: null, receiptFooterMessage: null,
  environment: ConnectionEnvironment.SANDBOX, status: ConnectionStatus.ACTIVE, cmcKey: 'k',
  lastCodeSyncAt: null, createdAt: new Date(), updatedAt: new Date(),
};

function doc(over: Partial<ComplianceDocument> = {}): ComplianceDocument {
  return {
    id: 'doc-1', merchantId: 'm-1', branchId: 'branch-1', sourceSystem: SourceSystem.API,
    sourceDocumentId: 'INV-1', documentType: DocumentType.SALE, documentNumber: 'INV-1',
    originalDocumentNumber: null, originalSaleId: null, sourceInvoiceId: null,
    mainApiSyncItemId: null, mainApiSyncBatchId: null, attachmentSyncStatus: null, attachmentSyncError: null,
    creditNoteDate: null, creditNoteReasonCode: null, saleDate: '2026-08-14', receiptTypeCode: 'S',
    paymentTypeCode: '01', invoiceStatusCode: '02', invoiceType: InvoiceType.NORMAL, currency: 'KES',
    exchangeRate: 1, subtotalAmount: 100, totalAmount: 100, totalTax: 0, customerPin: null, customerId: null,
    customerName: 'Grace Wanjiru', customerPhoneNumber: '0712 345 678', customerEmail: null,
    complianceStatus: ComplianceStatus.READY_FOR_SUBMISSION, submissionAttempts: 0, etimsReceiptNumber: null,
    totRcptNo: null, sdcDateTime: null, receiptLabel: null, oscuInvcNo: 5, idempotencyKey: 'i',
    createdAt: new Date('2026-08-14T10:00:00Z'), submittedAt: null,
    lines: [{
      id: 'l1', documentId: 'doc-1', itemId: 'item-1', etimsItemCodeSnapshot: 'KE2NTNO0000001',
      description: 'Flour', quantity: 2, unitPrice: 50, taxCategory: TaxCategory.VAT_STANDARD, taxAmount: 0,
      classificationCodeSnapshot: '14111400', unitCodeSnapshot: 'NO', packagingUnitCodeSnapshot: 'NT',
      taxTyCdSnapshot: 'B', productTypeCodeSnapshot: '2', createdAt: new Date(),
    }],
    ...over,
  } as ComplianceDocument;
}

const zeroBuckets = {
  taxableAmountA: 0, taxableAmountB: 86.21, taxableAmountC: 0, taxableAmountD: 0, taxableAmountE: 0,
  taxAmountA: 0, taxAmountB: 13.79, taxAmountC: 0, taxAmountD: 0, taxAmountE: 0,
  taxRateA: 0, taxRateB: 16, taxRateC: 0, taxRateD: 0, taxRateE: 0,
};

/** Everything the PDF writes with doc.text(), in order -- the paper's text. */
async function paperText(data: EtimsReceiptData): Promise<string[]> {
  const printed: string[] = [];
  const spy = jest
    .spyOn((PDFDocument as any).prototype, 'text')
    .mockImplementation(function (this: any, ...args: any[]) {
      printed.push(String(args[0]));
      return this;
    });
  try {
    await generateEtimsReceiptPdf(data);
  } finally {
    spy.mockRestore();
  }
  return printed;
}

function receiptData(view: ReturnType<typeof resolveReceiptView>, document = doc()): EtimsReceiptData {
  return {
    document, connection, itemsById: new Map([['item-1', { id: 'item-1', name: 'Flour' } as any]]),
    receiptNumber: 9, receiptSignature: 'SIG', internalData: 'INT', etimsUrl: null,
    supplierName: 'Legal Name Ltd', paymentTypeDescription: 'Cash', taxBuckets: zeroBuckets,
    totRcptNo: '9', sdcDateTime: '20260814110735', receiptLabel: 'NS', receiptView: view,
  };
}

function transmittedReceipt(payload: EtimsInvoicePayload) {
  return OscuSalesRequestBuilder.build({ payload, tin: 'P600004185A', bhfId: '00', cmcKey: 'k' }).receipt;
}

function payloadFor(view: ReturnType<typeof resolveReceiptView>): EtimsInvoicePayload {
  return {
    documentNumber: 'INV-1', documentType: 'SALE', invoiceSequence: 5, branchId: 'b', deviceId: 'd',
    currency: 'KES', exchangeRate: 1, subtotalAmount: 100, taxAmount: 0, totalAmount: 100,
    receiptText: receiptBlockTextFromView(view),
    lines: [{
      itemCode: 'KE2NTNO0000001', description: 'Flour', quantity: 2, unitPrice: 50, taxAmount: 0,
      classificationCode: '14111400', unitCode: 'NO', packagingUnitCode: 'NT', taxTyCd: 'B', productTypeCode: '2',
    }],
  };
}

const SETTINGS: ReceiptSettingsData = {
  sections: { itemCodes: { enabled: true } },
  texts: { tradeName: 'Sync To Books', address: 'Jamhuri, Langata, Nairobi', headerMessage: 'Welcome, karibu', footerMessage: 'THANK YOU, COME BACK' },
};

describe('paper == transmission', () => {
  /** Every transmitted text must be on the paper as the same string (trdeNm as the "Trading as" line). */
  function expectParity(paper: string[], sent: ReturnType<typeof transmittedReceipt>) {
    if (sent.trdeNm) expect(paper).toContain(`Trading as: ${sent.trdeNm}`);
    else expect(paper.some((t) => t.startsWith('Trading as'))).toBe(false);
    for (const v of [sent.adrs, sent.topMsg, sent.btmMsg]) {
      if (v) expect(paper).toContain(v);
    }
    if (sent.custMblNo) expect(paper).toContain(`Tel: ${sent.custMblNo}`);
    else expect(paper.some((t) => t.startsWith('Tel:'))).toBe(false);
  }

  it('a settings override reaches BOTH the paper text and the transmitted receipt block, identically', async () => {
    const view = resolveReceiptView({ settings: SETTINGS, supplierName: 'Legal Name Ltd', connection, customerPhone: '0712 345 678' });
    const paper = await paperText(receiptData(view));
    const sent = transmittedReceipt(payloadFor(view));

    expect(sent).toMatchObject({
      trdeNm: 'Sync To Books', adrs: 'Jamhuri, Langata, Nairobi', topMsg: 'Welcome, karibu',
      btmMsg: 'THANK YOU, COME BACK', custMblNo: '0712 345 678',
    });
    expectParity(paper, sent);
    expect(paper).toContain('Legal Name Ltd'); // legal name still prints, separately
    expect(paper).toContain('KE2NTNO0000001  Flour'); // item codes on
  });

  it('the full registered name is NEVER truncated on paper (and is not transmitted as trdeNm)', async () => {
    const view = resolveReceiptView({ settings: null, supplierName: 'SYNC TO BOOKS RECONCILER LIMITED', connection, customerPhone: null });
    const paper = await paperText(receiptData(view));
    const sent = transmittedReceipt(payloadFor(view));
    expect(paper).toContain('SYNC TO BOOKS RECONCILER LIMITED');
    expect(sent.trdeNm).toBeNull();
    expectParity(paper, sent);
  });

  it('legacy long header/footer are ignored: nothing printed, null transmitted', async () => {
    const view = resolveReceiptView({
      settings: null, supplierName: 'SYNC TO BOOKS RECONCILER LIMITED', customerPhone: null,
      connection: { ...connection, receiptHeaderMessage: 'Welcome to SYNC TO BOOKS RECONCILER LIMITED', receiptFooterMessage: 'THANK YOU - WE LOOK FORWARD TO EARNING YOUR BUSINESS' },
    });
    const paper = await paperText(receiptData(view));
    const sent = transmittedReceipt(payloadFor(view));
    expect(sent.topMsg).toBeNull();
    expect(sent.btmMsg).toBeNull();
    expect(paper.some((t) => /Welcome to|THANK YOU/.test(t))).toBe(false);
    expectParity(paper, sent);
  });

  it('a section switched off prints nothing AND transmits null', async () => {
    const view = resolveReceiptView({
      settings: { sections: { headerMessage: { enabled: false }, footerMessage: { enabled: false }, customerPhone: { enabled: false }, tradeName: { enabled: false } }, texts: { tradeName: 'Brand', headerMessage: 'Hi', footerMessage: 'Bye' } },
      supplierName: 'Legal Name Ltd', connection, customerPhone: '0712345678',
    });
    const paper = await paperText(receiptData(view));
    const sent = transmittedReceipt(payloadFor(view));
    expect(sent).toMatchObject({ trdeNm: null, topMsg: null, btmMsg: null, custMblNo: null });
    expectParity(paper, sent);
    expect(paper).not.toContain('Hi');
  });

  it('default view for an unconfigured business: no header/footer/trade name on paper or wire; mandatory blocks print', async () => {
    const view = resolveReceiptView({ settings: null, supplierName: 'Legal Name Ltd', connection, customerPhone: null });
    const paper = await paperText(receiptData(view));
    const sent = transmittedReceipt(payloadFor(view));
    expect(sent).toMatchObject({ trdeNm: null, topMsg: null, btmMsg: null });
    expect(paper).not.toContain('KE2NTNO0000001  Flour');
    expect(paper).toEqual(expect.arrayContaining(['SCU INFORMATION', 'TIS INFORMATION', 'Tax Category', 'Supplier Details']));
    expect(paper.some((t) => t.startsWith('PIN: '))).toBe(true);
    expect(paper.some((t) => t.startsWith('CU Invoice No.: '))).toBe(true);
    expectParity(paper, sent);
  });

  it('a document transmitted before settings existed (no snapshot) still prints as before: full name, old messages', async () => {
    const input = { settings: null, supplierName: 'SYNC TO BOOKS RECONCILER LIMITED', customerPhone: null, connection: { ...connection, receiptHeaderMessage: 'Welcome to SYNC TO BOOKS RECONCILER LIMITED', receiptFooterMessage: null } };
    const paper = await paperText(receiptData(legacyReceiptView(resolveReceiptView(input), input)));
    expect(paper).toContain('SYNC TO BOOKS RECONCILER LIMITED');
    expect(paper).toContain('Welcome to SYNC TO BOOKS RECONCILER LIMITED');
    expect(paper).toContain('THANK YOU\nWE LOOK FORWARD TO EARNING YOUR BUSINESS');
    expect(paper.some((t) => t.startsWith('Trading as'))).toBe(false);
  });

  it('with no resolver wired (legacy callers) the transmission keeps the old null block', () => {
    const p = payloadFor(resolveReceiptView({ settings: null, supplierName: 'x', connection, customerPhone: null }));
    delete p.receiptText;
    expect(transmittedReceipt(p)).toMatchObject({ trdeNm: null, adrs: null, topMsg: null, btmMsg: null, custMblNo: null });
  });

  it('submitDocument transmits the resolved block, snapshots it, and a later settings change cannot alter the issued paper', async () => {
    let document = doc();
    const sentPayloads: EtimsInvoicePayload[] = [];
    const documentRepo = {
      findById: jest.fn(async () => document),
      save: jest.fn(async (d: ComplianceDocument) => (document = d)),
      findSaleByDocumentNumber: jest.fn(async () => null),
    };
    const adapter = {
      submitInvoice: jest.fn(async (p: EtimsInvoicePayload) => {
        sentPayloads.push(p);
        return { success: true, receiptNumber: '9', rawResponse: { data: { totRcptNo: '9', sdcDateTime: '20260814110735' } } };
      }),
    };
    const result = await submitDocument(
      'doc-1',
      documentRepo as any,
      { findByMerchantAndBranch: async () => connection } as any,
      { append: jest.fn() } as any,
      adapter as any,
      { findOne: async () => null, upsert: async () => undefined } as any,
      async (d, c) =>
        receiptBlockTextFromView(
          resolveReceiptView({ settings: SETTINGS, supplierName: 'Legal Name Ltd', connection: c, customerPhone: d.customerPhoneNumber }),
        ),
    );
    expect(result.success).toBe(true);
    const wire = transmittedReceipt(sentPayloads[0]);
    expect(wire.trdeNm).toBe('Sync To Books');
    expect(document.receiptTextSnapshot).toEqual(sentPayloads[0].receiptText);

    // The business now edits its settings...
    const changed = resolveReceiptView({
      settings: { sections: {}, texts: { tradeName: 'Totally New', headerMessage: 'New header' } },
      supplierName: 'Legal Name Ltd', connection, customerPhone: document.customerPhoneNumber,
    });
    // ...but the issued document's paper still prints what KRA was sent.
    const view = applyTransmittedSnapshot(changed, document.receiptTextSnapshot);
    const paper = await paperText(receiptData(view, document));
    expect(paper).toContain(`Trading as: ${wire.trdeNm}`);
    expect(paper).toContain(wire.topMsg);
    expect(paper).not.toContain('Totally New');
    expect(paper).not.toContain('Trading as: Totally New');
  });
});
