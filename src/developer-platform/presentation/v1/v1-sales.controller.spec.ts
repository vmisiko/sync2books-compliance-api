import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ItemNotReadyForEtimsError } from '../../../sales/domain/errors/item-not-ready-for-etims.error';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { V1ScopeService } from '../../application/v1-scope.service';
import { V1SalesController } from './v1-sales.controller';

const TENANT = 'tenant-A';
const MERCHANT = 'merchant-A';

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    date: '21/09/2026',
    traderInvoiceNumber: 'INV-001',
    isCreditNote: false,
    status: 'completed',
    paymentTypeCode: '01',
    customerName: 'Karibu Ltd',
    customerTin: null,
    customerPhoneNumber: null,
    customerEmail: null,
    itemList: [
      {
        id: 'l1',
        itemId: 'item-1',
        itemName: 'ERP integration',
        itemDescription: null,
        quantity: 1,
        unitPrice: 11600,
        totalAmount: 11600,
        taxableAmount: 10000,
        taxAmount: 1600,
        taxRate: 16,
        taxTypeCode: 'B',
      },
    ],
    cuInvoiceNo: 'KRACU0100000001/1',
    receiptNumber: 1,
    receiptLabel: null,
    scuId: 'KRACU0100000001',
    scuDate: '21/09/2026',
    scuTime: '10:00:00',
    totRcptNo: '1',
    receiptSignature: 'AAAA-BBBB',
    internalData: 'CCCC-DDDD',
    etimsUrl: 'https://etims-sbx.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=x',
    originalCuInvoiceNo: null,
    originalSaleId: null,
    syncErrorMessage: null,
    // Internal fields that must never reach a caller:
    saleDetailUrl: '/api/sales/doc-1',
    serialNumber: 'DEVICE-SERIAL',
    attachmentSyncStatus: 'SYNCED',
    sourceSystem: 'API',
    ...overrides,
  };
}

function build(opts: {
  ownedItems?: string[];
  ownedSales?: Record<string, Record<string, unknown>>;
  existingByNumber?: { sourceDocumentId: string } | null;
  createdNew?: boolean;
  submit?: () => Promise<unknown>;
  finalReport?: Record<string, unknown>;
} = {}) {
  const ownedItems = new Set(opts.ownedItems ?? ['item-1']);
  const scope = {
    merchantIdFor: jest.fn(async () => MERCHANT),
    requireItems: jest.fn(async (_m: string, ids: string[]) => {
      for (const id of ids) {
        if (!ownedItems.has(id)) throw new NotFoundException(`Item ${id} not found`);
      }
      return new Map(
        ids.map((id) => [id, { id, taxCategory: 'VAT_STANDARD', taxTyCd: 'B' }]),
      );
    }),
    resolveBranch: jest.fn(async () => ({ id: 'branch-1' })),
    requireSale: jest.fn(async (_m: string, id: string) => {
      const found = opts.ownedSales?.[id];
      if (!found) throw new NotFoundException(`Sale ${id} not found`);
      return found;
    }),
  } as unknown as V1ScopeService;

  const sales = {
    findSaleByTraderNumber: jest.fn(async () => opts.existingByNumber ?? null),
    createDocument: jest.fn(async () => ({
      created: opts.createdNew ?? true,
      document: { id: 'doc-1' },
    })),
    submitDraftDocument: jest.fn(opts.submit ?? (async () => undefined)),
    getNormalizedSaleReport: jest.fn(async () => report(opts.finalReport)),
    retrySales: jest.fn(async () => ({ attempted: 1 })),
    listNormalizedSaleReports: jest.fn(async () => ({
      data: [report()],
      pagination: { next: null, previous: 'doc-1', pageSize: 20 },
    })),
    getEtimsReceiptPdf: jest.fn(async () => Buffer.from('%PDF')),
  };

  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    set() {
      return this;
    },
  };

  return {
    controller: new V1SalesController(sales as never, scope),
    sales,
    scope,
    res: res as never,
    raw: res,
  };
}

const goodBody = {
  traderInvoiceNumber: 'INV-001',
  saleDate: '2026-09-21',
  lines: [{ itemId: 'item-1', quantity: 1, unitPrice: 11600 }],
};

describe('V1SalesController', () => {
  describe('POST /v1/sales', () => {
    it('issues a sale and answers 201 with the receipt', async () => {
      const { controller, sales, raw, res } = build();
      const out = await controller.createSale(TENANT, goodBody, null, res);

      expect(raw.statusCode).toBe(201);
      expect(out.data.sale.status).toBe('completed');
      expect(out.data.sale.receipt?.cuInvoiceNo).toBe('KRACU0100000001/1');
      expect(sales.submitDraftDocument).toHaveBeenCalledWith('doc-1');
    });

    // The bug this whole layer exists to prevent: createDocument does not
    // compare an item's merchant to the document's.
    it("refuses a sale that names another business's item, before anything is created", async () => {
      const { controller, sales, res } = build({ ownedItems: [] });
      await expect(controller.createSale(TENANT, goodBody, null, res)).rejects.toThrow(
        NotFoundException,
      );
      expect(sales.createDocument).not.toHaveBeenCalled();
    });

    it('stamps the sale with the guard-resolved business, never one from the body', async () => {
      const { controller, sales, res } = build();
      await controller.createSale(
        TENANT,
        { ...goodBody, merchantId: 'merchant-EVIL', businessId: 'tenant-EVIL' },
        null,
        res,
      );
      const input = (sales.createDocument.mock.calls[0] as unknown as [Record<string, unknown>])[0];
      expect(input.merchantId).toBe(MERCHANT);
    });

    it('takes the tax category from the item, not from the caller', async () => {
      const { controller, sales, res } = build();
      await controller.createSale(
        TENANT,
        {
          ...goodBody,
          lines: [{ itemId: 'item-1', quantity: 1, unitPrice: 11600, taxCategory: 'EXEMPT', taxAmount: 999 }],
        },
        null,
        res,
      );
      const input = (sales.createDocument.mock.calls[0] as unknown as [{ lines: Array<Record<string, unknown>> }])[0];
      expect(input.lines[0].taxCategory).toBe('VAT_STANDARD');
      // A caller-supplied tax amount is never carried onto a fiscal document.
      expect(input.lines[0].taxAmount).toBe(0);
    });

    // The structural validator wants total = subtotal + tax with subtotal = the
    // sum of line totals. Prices are tax-inclusive, so the only self-consistent
    // stored form is tax 0 -- splitting VAT out here failed live validation
    // (subtotal 10000 vs lines 11600). KRA still gets the right split: the OSCU
    // request derives it from each line's tax type.
    it('stores totals the way the structural validator expects', async () => {
      const { controller, sales, res } = build();
      await controller.createSale(TENANT, goodBody, null, res);
      const input = (sales.createDocument.mock.calls[0] as unknown as [Record<string, number>])[0];
      expect(input.subtotalAmount).toBe(11600);
      expect(input.totalTax).toBe(0);
      expect(input.totalAmount).toBe(11600);
      expect(input.subtotalAmount + input.totalTax).toBe(input.totalAmount);
    });

    it.each([
      ['a string quantity', { lines: [{ itemId: 'item-1', quantity: '2', unitPrice: 1 }] }],
      ['a zero quantity', { lines: [{ itemId: 'item-1', quantity: 0, unitPrice: 1 }] }],
      ['a negative price', { lines: [{ itemId: 'item-1', quantity: 1, unitPrice: -1 }] }],
      ['no lines', { lines: [] }],
      ['a bad date', { saleDate: '21/09/2026' }],
    ])('400s %s without creating anything', async (_label, patch) => {
      const { controller, sales, res } = build();
      await expect(
        controller.createSale(TENANT, { ...goodBody, ...patch }, null, res),
      ).rejects.toThrow(BadRequestException);
      expect(sales.createDocument).not.toHaveBeenCalled();
    });

    it('names the offending line', async () => {
      const { controller, res } = build();
      await expect(
        controller.createSale(
          TENANT,
          { ...goodBody, lines: [{ itemId: 'item-1', quantity: 1, unitPrice: 1 }, { itemId: 'item-1', quantity: 'x', unitPrice: 1 }] },
          null,
          res,
        ),
      ).rejects.toThrow('lines[1].quantity must be a number');
    });

    describe('idempotency', () => {
      it('uses the Idempotency-Key as the source document id', async () => {
        const { controller, sales, res } = build();
        await controller.createSale(TENANT, goodBody, 'order-0042-abc', res);
        const input = (sales.createDocument.mock.calls[0] as unknown as [Record<string, string>])[0];
        expect(input.sourceDocumentId).toBe('order-0042-abc');
        expect(input.documentNumber).toBe('INV-001');
      });

      it('replays an existing sale with 200 and does not resubmit', async () => {
        const { controller, sales, raw, res } = build({ createdNew: false });
        const out = await controller.createSale(TENANT, goodBody, null, res);

        expect(raw.statusCode).toBe(200);
        expect(raw.headers['Idempotent-Replayed']).toBe('true');
        expect(out.data.sale.id).toBe('doc-1');
        expect(sales.submitDraftDocument).not.toHaveBeenCalled();
      });

      it('409s the same trader number under a different key, rather than filing a second invoice', async () => {
        const { controller, sales, res } = build({ existingByNumber: { sourceDocumentId: 'first-key-123' } });
        await expect(
          controller.createSale(TENANT, goodBody, 'second-key-456', res),
        ).rejects.toThrow(ConflictException);
        expect(sales.createDocument).not.toHaveBeenCalled();
      });

      it('lets the original key through against the existing sale', async () => {
        const { controller, res } = build({
          existingByNumber: { sourceDocumentId: 'first-key-123' },
          createdNew: false,
        });
        await expect(
          controller.createSale(TENANT, goodBody, 'first-key-123', res),
        ).resolves.toBeDefined();
      });
    });

    describe("KRA's verdict decides the HTTP status", () => {
      it('is 422 with the sale attached when KRA rejects', async () => {
        const { controller, res } = build({
          finalReport: { status: 'failed', syncErrorMessage: 'Invalid itemCd' },
        });
        const error = await controller.createSale(TENANT, goodBody, null, res).catch((e) => e);
        expect(error).toBeInstanceOf(UnprocessableEntityException);
        const body = error.getResponse();
        expect(body.code).toBe('kra_rejected');
        expect(body.message).toBe('Invalid itemCd');
        expect(body.sale.id).toBe('doc-1');
        expect(body.sale.error).toBe('Invalid itemCd');
        // No receipt for a document KRA did not sign.
        expect(body.sale.receipt).toBeNull();
      });

      it('is 202 while the document is still in flight', async () => {
        const { controller, raw, res } = build({ finalReport: { status: 'retrying' } });
        await controller.createSale(TENANT, goodBody, null, res);
        expect(raw.statusCode).toBe(202);
      });

      it('keeps the draft visible when validation fails', async () => {
        const { controller, res } = build({
          submit: async () => {
            throw new BadRequestException({ message: 'Sale validation failed', errors: [{ field: 'x' }] });
          },
          finalReport: { status: 'ready_to_submit' },
        });
        const error = await controller.createSale(TENANT, goodBody, null, res).catch((e) => e);
        expect(error).toBeInstanceOf(UnprocessableEntityException);
        expect(error.getResponse().code).toBe('validation_failed');
        // The caller can see, and retry, the draft that now exists.
        expect(error.getResponse().sale.id).toBe('doc-1');
      });

      it('tells the caller how to recover from an unregistered item', async () => {
        const { controller, res } = build({
          submit: async () => {
            throw new ItemNotReadyForEtimsError('Item is PENDING.');
          },
        });
        const error = await controller.createSale(TENANT, goodBody, null, res).catch((e) => e);
        expect(error.getResponse().code).toBe('item_not_registered');
        expect(error.getResponse().message).toContain('/v1/sales/doc-1/retry');
      });
    });

    // The view is an allow-list: internal fields on the source report stay private.
    it('never leaks internal report fields', async () => {
      const { controller, res } = build();
      const out = await controller.createSale(TENANT, goodBody, null, res);
      const json = JSON.stringify(out);
      expect(json).not.toContain('saleDetailUrl');
      expect(json).not.toContain('/api/sales');
      expect(json).not.toContain('DEVICE-SERIAL');
      expect(json).not.toContain('attachmentSync');
      expect(json).not.toContain('sourceSystem');
    });

    it('returns the sale date as ISO, not the receipt format', async () => {
      const { controller, res } = build();
      const out = await controller.createSale(TENANT, goodBody, null, res);
      expect(out.data.sale.saleDate).toBe('2026-09-21');
    });
  });

  describe('GET /v1/sales/:id', () => {
    it("404s another business's sale", async () => {
      const { controller } = build({ ownedSales: {} });
      await expect(controller.getSale(TENANT, 'foreign')).rejects.toThrow(NotFoundException);
    });
    it('returns an owned sale', async () => {
      const { controller } = build({ ownedSales: { 'doc-1': { id: 'doc-1' } } });
      await expect(controller.getSale(TENANT, 'doc-1')).resolves.toMatchObject({
        data: { sale: { id: 'doc-1' } },
      });
    });
  });

  describe('GET /v1/sales', () => {
    it("refuses a cursor that is not this business's document", async () => {
      const { controller, sales } = build({ ownedSales: {} });
      await expect(controller.listSales(TENANT, 'foreign-doc')).rejects.toThrow(NotFoundException);
      expect(sales.listNormalizedSaleReports).not.toHaveBeenCalled();
    });
    it("scopes the listing to the business's merchant id", async () => {
      const { controller, sales } = build();
      await controller.listSales(TENANT);
      expect(sales.listNormalizedSaleReports).toHaveBeenCalledWith(
        expect.objectContaining({ merchantId: MERCHANT, pageSize: 20 }),
      );
    });
    it('refuses an out-of-range page size', async () => {
      const { controller } = build();
      await expect(controller.listSales(TENANT, undefined, '500')).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /v1/sales/:id/retry', () => {
    // retrySales treats an omitted documentIds as "every retryable document for
    // this business". Naming one sale must never fall through to that.
    it('always retries exactly the one owned sale', async () => {
      const { controller, sales } = build({ ownedSales: { 'doc-1': { id: 'doc-1' } } });
      await controller.retrySale(TENANT, 'doc-1');
      expect(sales.retrySales).toHaveBeenCalledWith({
        merchantId: MERCHANT,
        documentIds: ['doc-1'],
      });
    });
    it("does not retry another business's sale", async () => {
      const { controller, sales } = build({ ownedSales: {} });
      await expect(controller.retrySale(TENANT, 'foreign')).rejects.toThrow(NotFoundException);
      expect(sales.retrySales).not.toHaveBeenCalled();
    });
    it('is 422 when it fails again', async () => {
      const { controller } = build({
        ownedSales: { 'doc-1': { id: 'doc-1' } },
        finalReport: { status: 'failed', syncErrorMessage: 'still bad' },
      });
      await expect(controller.retrySale(TENANT, 'doc-1')).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('GET /v1/sales/:id/receipt', () => {
    it("404s another business's receipt without rendering it", async () => {
      const { controller, sales, res } = build({ ownedSales: {} });
      await expect(controller.getReceipt(TENANT, 'foreign', res)).rejects.toThrow(NotFoundException);
      expect(sales.getEtimsReceiptPdf).not.toHaveBeenCalled();
    });
    it('passes copy=true through', async () => {
      const { controller, sales, res } = build({ ownedSales: { 'doc-1': { id: 'doc-1' } } });
      await controller.getReceipt(TENANT, 'doc-1', res, 'true');
      expect(sales.getEtimsReceiptPdf).toHaveBeenCalledWith('doc-1', { copy: true });
    });
    it('404s when KRA has not accepted the sale', async () => {
      const { controller, sales, res } = build({ ownedSales: { 'doc-1': { id: 'doc-1' } } });
      sales.getEtimsReceiptPdf.mockResolvedValueOnce(null as never);
      await expect(controller.getReceipt(TENANT, 'doc-1', res)).rejects.toThrow(NotFoundException);
    });
  });

  describe('POST /v1/credit-notes', () => {
    const accepted = {
      id: 'sale-1',
      documentType: DocumentType.SALE,
      complianceStatus: ComplianceStatus.ACCEPTED,
      documentNumber: 'INV-001',
      branchId: 'branch-1',
      paymentTypeCode: '01',
      invoiceStatusCode: '02',
      currency: 'KES',
      exchangeRate: 1,
      totalTax: 1600,
      customerPin: null,
      customerId: null,
      customerName: 'Karibu Ltd',
      customerPhoneNumber: null,
      customerEmail: null,
      lines: [{ itemId: 'item-1', description: 'ERP', quantity: 1, unitPrice: 11600, taxCategory: 'VAT_STANDARD', taxAmount: 1600 }],
    };
    const body = { saleId: 'sale-1', traderInvoiceNumber: 'CN-001', returnDate: '2026-09-22' };

    it("404s a sale that is not this business's", async () => {
      const { controller, sales, res } = build({ ownedSales: {} });
      await expect(controller.createCreditNote(TENANT, body, null, res)).rejects.toThrow(NotFoundException);
      expect(sales.createDocument).not.toHaveBeenCalled();
    });

    it('refuses to credit a sale KRA has not accepted', async () => {
      const { controller, res } = build({
        ownedSales: { 'sale-1': { ...accepted, complianceStatus: ComplianceStatus.REJECTED } },
      });
      const error = await controller.createCreditNote(TENANT, body, null, res).catch((e) => e);
      expect(error.getResponse().code).toBe('sale_not_accepted');
    });

    it('refuses to credit a credit note', async () => {
      const { controller, res } = build({
        ownedSales: { 'sale-1': { ...accepted, documentType: DocumentType.CREDIT_NOTE } },
      });
      const error = await controller.createCreditNote(TENANT, body, null, res).catch((e) => e);
      expect(error.getResponse().code).toBe('not_a_sale');
    });

    it('links the credit note to the original and carries the buyer over', async () => {
      const { controller, sales, res } = build({ ownedSales: { 'sale-1': accepted } });
      await controller.createCreditNote(TENANT, body, null, res);
      const input = (sales.createDocument.mock.calls[0] as unknown as [Record<string, unknown>])[0];
      expect(input.documentType).toBe(DocumentType.CREDIT_NOTE);
      expect(input.originalSaleId).toBe('sale-1');
      expect(input.originalDocumentNumber).toBe('INV-001');
      expect(input.receiptTypeCode).toBe('R');
      expect(input.customerName).toBe('Karibu Ltd');
      expect(input.creditNoteReasonCode).toBe('06');
    });

    it("keeps total = subtotal + tax, in the original's own convention", async () => {
      // An original stored with tax on top: 10000 of lines, 1600 tax.
      const withTax = {
        ...accepted,
        lines: [{ ...accepted.lines[0], unitPrice: 10000, taxAmount: 1600 }],
      };
      const { controller, sales, res } = build({ ownedSales: { 'sale-1': withTax } });
      await controller.createCreditNote(TENANT, body, null, res);
      const input = (sales.createDocument.mock.calls[0] as unknown as [Record<string, number>])[0];
      expect(input.subtotalAmount).toBe(10000);
      expect(input.totalTax).toBe(1600);
      expect(input.totalAmount).toBe(11600);
    });

    it('credits a tax-inclusive original (tax 0) without inventing tax', async () => {
      const inclusive = { ...accepted, lines: [{ ...accepted.lines[0], taxAmount: 0 }] };
      const { controller, sales, res } = build({ ownedSales: { 'sale-1': inclusive } });
      await controller.createCreditNote(TENANT, body, null, res);
      const input = (sales.createDocument.mock.calls[0] as unknown as [Record<string, number>])[0];
      expect(input.totalTax).toBe(0);
      expect(input.totalAmount).toBe(11600);
    });

    it('rejects an unknown reason code', async () => {
      const { controller, res } = build({ ownedSales: { 'sale-1': accepted } });
      await expect(
        controller.createCreditNote(TENANT, { ...body, reason: '99' }, null, res),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
