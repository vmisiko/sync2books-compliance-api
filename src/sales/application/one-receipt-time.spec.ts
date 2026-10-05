import { SalesService, receiptDateAndTime } from './sales.service';
import { submitDocument } from './use-cases/submit-document.usecase';
import { OscuSalesRequestBuilder } from '../../regulatory/oscu/mapping/oscu-sales-request.builder';
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import { ConnectionStatus } from '../../shared/domain/enums/connection-status.enum';
import type { ComplianceDocument } from '../domain/entities/compliance-document.entity';
import type { EtimsInvoicePayload } from '../../regulatory/oscu/mapping/etims-payload.types';

// "One consistent transmitted time on the receipt": the time sent to KRA in cfmDt/rcptPbctDt/
// stockRlsDt is persisted as `transmittedAt` and is what the receipt prints, not KRA's sdcDateTime.

const SDC = '20261005172434'; // KRA's own signing time (15s after we transmitted)
const T = '20261005172419';

function payload(saleDate?: string): EtimsInvoicePayload {
  return {
    documentNumber: 'INV-1',
    documentType: 'SALE_INVOICE',
    invoiceSequence: 1,
    branchId: '00',
    deviceId: 'dev',
    currency: 'KES',
    exchangeRate: 1,
    subtotalAmount: 100,
    taxAmount: 0,
    totalAmount: 100,
    saleDate,
    lines: [
      {
        itemCode: 'ITEM-1',
        description: 'Line',
        quantity: 1,
        unitPrice: 100,
        taxAmount: 0,
        classificationCode: '14111400',
        unitCode: 'NO',
        packagingUnitCode: 'NT',
        taxTyCd: 'B',
        productTypeCode: '2',
      },
    ],
  } as unknown as EtimsInvoicePayload;
}

function build(saleDate: string | undefined, now: Date) {
  return OscuSalesRequestBuilder.build({
    payload: payload(saleDate),
    tin: 'A1',
    bhfId: '00',
    cmcKey: 'c',
    now,
  });
}

describe('request time stamping', () => {
  it('sends the same instant in cfmDt, rcptPbctDt and stockRlsDt', () => {
    // 14:24:19Z = 17:24:19 Nairobi
    const req = build(undefined, new Date('2026-10-05T14:24:19Z'));
    expect(req.cfmDt).toBe('20261005172419');
    expect(req.stockRlsDt).toBe(req.cfmDt);
    expect(req.receipt.rcptPbctDt).toBe(req.cfmDt);
  });

  it('keeps a backdated sale on its date at 12:00:00 in all three fields', () => {
    const req = build('2026-09-01', new Date('2026-10-05T14:24:19Z'));
    expect(req.cfmDt).toBe('20260901120000');
    expect(req.stockRlsDt).toBe('20260901120000');
    expect(req.receipt.rcptPbctDt).toBe('20260901120000');
  });
});

describe('submitDocument persists the transmitted time', () => {
  function harness(submitInvoice: jest.Mock) {
    let current = {
      id: 'doc-1',
      merchantId: 'm',
      branchId: 'b',
      documentNumber: 'INV-1',
      complianceStatus: ComplianceStatus.READY_FOR_SUBMISSION,
      submissionAttempts: 0,
      oscuInvcNo: 1,
      originalSaleId: null,
      originalDocumentNumber: null,
      currency: 'KES',
      exchangeRate: 1,
      subtotalAmount: 100,
      totalAmount: 100,
      totalTax: 0,
      lines: [],
      transmittedAt: null,
      submittedAt: null,
      createdAt: new Date(),
    } as unknown as ComplianceDocument;
    const documentRepo = {
      findById: () => Promise.resolve(current),
      save: (d: ComplianceDocument) => {
        current = d;
        return Promise.resolve(d);
      },
    };
    const connectionRepo = {
      findByMerchantAndBranch: () =>
        Promise.resolve({
          kraPin: 'P1',
          kraBhfId: '00',
          cmcKey: 'k',
          deviceId: 'd',
          environment: 'SANDBOX',
          status: ConnectionStatus.ACTIVE,
        }),
    };
    return {
      run: () =>
        submitDocument(
          'doc-1',
          documentRepo as never,
          connectionRepo as never,
          { append: jest.fn().mockResolvedValue(undefined) } as never,
          { submitInvoice } as never,
          { findOne: jest.fn(), upsert: jest.fn() } as never,
        ),
      current: () => current,
    };
  }

  it('persists exactly what the request carried, and a retry re-stamps', async () => {
    const clock = [
      new Date('2026-10-05T14:24:19Z'),
      new Date('2026-10-05T14:30:00Z'),
    ];
    const sent: Array<ReturnType<typeof build>> = [];
    const submitInvoice = jest.fn().mockImplementation(() => {
      const req = build(undefined, clock[sent.length]);
      sent.push(req);
      return Promise.resolve(
        sent.length === 1
          ? { success: false, error: 'retryable: timeout', transmittedAt: req.cfmDt }
          : { success: true, receiptNumber: '5', transmittedAt: req.cfmDt },
      );
    });
    const h = harness(submitInvoice);

    await h.run();
    expect(h.current().complianceStatus).toBe(ComplianceStatus.RETRYING);
    expect(h.current().transmittedAt).toBe('20261005172419');

    await h.run();
    expect(h.current().complianceStatus).toBe(ComplianceStatus.ACCEPTED);
    expect(sent[1].cfmDt).toBe('20261005173000');
    expect(h.current().transmittedAt).toBe(sent[1].cfmDt);
    expect(h.current().transmittedAt).toBe(sent[1].stockRlsDt);
    expect(h.current().transmittedAt).toBe(sent[1].receipt.rcptPbctDt);
  });
});

describe('receipt prints the transmitted time', () => {
  function service(doc: Partial<ComplianceDocument>) {
    const document = {
      id: 'doc-1',
      merchantId: 'm',
      branchId: 'b',
      documentType: 'SALE',
      documentNumber: 'INV-1',
      saleDate: '2026-10-05',
      complianceStatus: ComplianceStatus.ACCEPTED,
      totRcptNo: null,
      sdcDateTime: SDC,
      receiptLabel: null,
      createdAt: new Date('2026-10-05T14:24:18Z'),
      lines: [],
      ...doc,
    } as unknown as ComplianceDocument;
    return new SalesService(
      {
        findById: jest.fn().mockResolvedValue(document),
        findSaleByDocumentNumber: jest.fn().mockResolvedValue(null),
        findCreditNotesByOriginalSaleId: jest.fn().mockResolvedValue([]),
      } as never,
      {
        findByDocumentId: jest.fn().mockResolvedValue([
          {
            id: 'e',
            documentId: 'doc-1',
            eventType: 'ACCEPTED',
            payloadSnapshot: null,
            responseSnapshot: {
              data: { curRcptNo: 9, rcptSign: 'SIGN', sdcDateTime: SDC },
            },
            createdAt: new Date(),
          },
        ]),
      } as never,
      { findByIds: jest.fn().mockResolvedValue([]) } as never,
      { findByMerchantAndBranch: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
      {} as never,
      { getTenantBySync2booksCompanyId: jest.fn().mockResolvedValue(null) } as never,
    );
  }

  it('scuDate/scuTime and date/time carry T, not sdcDateTime or createdAt', async () => {
    const r = await service({ transmittedAt: T }).getNormalizedSaleReport('doc-1');
    expect(r.scuDate).toBe('05/10/2026');
    expect(r.scuTime).toBe('17:24:19');
    expect(r.date).toBe('05/10/2026');
    expect(r.time).toBe('05:24:19 pm');
  });

  it('old documents without T fall back to sdcDateTime (SCU) and createdAt (time)', async () => {
    const r = await service({ transmittedAt: null }).getNormalizedSaleReport('doc-1');
    expect(r.scuTime).toBe('17:24:34');
    expect(r.time).toBe('05:24:18 pm');
    expect(r.date).toBe('05/10/2026');
  });

  it('receiptDateAndTime formats midnight-hour and noon correctly', () => {
    expect(
      receiptDateAndTime({ transmittedAt: '20261005000102' } as ComplianceDocument).time,
    ).toBe('12:01:02 am');
    expect(
      receiptDateAndTime({ transmittedAt: '20260901120000' } as ComplianceDocument),
    ).toEqual({ date: '01/09/2026', time: '12:00:00 pm' });
  });
});
