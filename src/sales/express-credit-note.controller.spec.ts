import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiSalesController } from './controller/api-sales.controller';
import { DashboardSalesController } from './controller/dashboard-sales.controller';
import { SalesService } from './application/sales.service';
import { ComplianceStatus } from '../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../shared/domain/enums/document-type.enum';
import { InvoiceType } from '../shared/domain/enums/invoice-type.enum';
import { SourceSystem } from '../shared/domain/enums/source-system.enum';
import type { Request } from 'express';
import { PlatformOscuCallbackService } from '../integration/platform-outbound/platform-oscu-callback.service';
import { Sync2BooksCorrelationPersistenceService } from '../integration/platform-outbound/sync2books-correlation-persistence.service';
import { InvoiceReceiptPushbackService } from '../integration/platform-outbound/invoice-receipt-pushback.service';
import { MerchantOwnershipGuard } from '../dashboard-identity/infrastructure/guards/merchant-ownership.guard';
import { SaleOwnershipGuard } from './controller/sale-ownership.guard';
import { AssertedMerchantGuard } from '../integration/asserted-merchant.guard';
import { MailerService } from '../mailer/mailer.service';
import { CatalogService } from '../catalog/api/catalog.service';

describe('Express credit note controllers', () => {
  let apiController: ApiSalesController;
  let dashboardController: DashboardSalesController;
  let salesService: {
    getDocument: jest.Mock;
    findDocumentForMerchant: jest.Mock;
    createDocument: jest.Mock;
    validateDocument: jest.Mock;
    prepareDocument: jest.Mock;
    submitDocument: jest.Mock;
    getNormalizedSaleReport: jest.Mock;
  };
  let catalogService: { getItemById: jest.Mock; getItemClassification: jest.Mock };

  const acceptedSale = {
    id: 'sale-1',
    merchantId: 'merchant-1',
    branchId: 'branch-1',
    sourceSystem: SourceSystem.API,
    sourceDocumentId: 'INV-123',
    documentType: DocumentType.SALE,
    documentNumber: 'INV-123',
    originalDocumentNumber: null,
    originalSaleId: null,
    saleDate: '2026-02-20',
    receiptTypeCode: 'S',
    paymentTypeCode: '01',
    invoiceStatusCode: '02',
    invoiceType: InvoiceType.NORMAL,
    currency: 'KES',
    exchangeRate: 1,
    subtotalAmount: 100,
    totalAmount: 116,
    totalTax: 16,
    customerPin: null,
    complianceStatus: ComplianceStatus.ACCEPTED,
    submissionAttempts: 1,
    etimsReceiptNumber: 'R-1',
    idempotencyKey: 'idem',
    createdAt: new Date('2026-02-20T10:00:00Z'),
    submittedAt: new Date('2026-02-20T10:01:00Z'),
    lines: [
      {
        id: 'line-1',
        documentId: 'sale-1',
        itemId: 'item-1',
        description: 'Line',
        quantity: 1,
        unitPrice: 100,
        taxCategory: 'VAT_STANDARD',
        taxAmount: 16,
        classificationCodeSnapshot: '14111400',
        unitCodeSnapshot: 'U',
        packagingUnitCodeSnapshot: 'NT',
        taxTyCdSnapshot: 'B',
        productTypeCodeSnapshot: '2',
        createdAt: new Date('2026-02-20T10:00:00Z'),
      },
    ],
  };

  const emptyReq = {} as Request;

  beforeEach(async () => {
    salesService = {
      getDocument: jest.fn().mockResolvedValue({ document: acceptedSale }),
      // The dashboard route answers a saleId under another merchant exactly like
      // an unknown one; this stands in for that merchant-scoped lookup.
      findDocumentForMerchant: jest
        .fn()
        .mockImplementation(async (id: string, merchantId: string) =>
          id === acceptedSale.id && merchantId === acceptedSale.merchantId
            ? acceptedSale
            : null,
        ),
      createDocument: jest.fn().mockResolvedValue({
        document: { id: 'cn-1' },
        created: true,
      }),
      validateDocument: jest.fn().mockResolvedValue({
        validation: { isValid: true, errors: [], warnings: [] },
      }),
      prepareDocument: jest.fn().mockResolvedValue({}),
      submitDocument: jest.fn().mockResolvedValue({}),
      getNormalizedSaleReport: jest.fn().mockResolvedValue({ id: 'cn-1' }),
    };
    // Defaults every item to Exempt-registered, so the invoiceType tests below
    // exercise applyInvoiceTypeOverride itself, not this registration gate --
    // the gate has its own dedicated describe block further down.
    catalogService = {
      getItemById: jest.fn().mockImplementation(async (id: string) => ({
        id,
        name: `Item ${id}`,
        classificationCode: 'CLS-EXEMPT',
      })),
      // Defaults every classification to Exempt-taxed, matching the default
      // item above, so the invoiceType tests below exercise
      // applyInvoiceTypeOverride itself, not this eligibility gate -- the
      // gate has its own dedicated describe block further down.
      getItemClassification: jest.fn().mockImplementation(async (itemClsCd: string) => ({
        itemClsCd,
        taxTyCd: 'A',
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiSalesController, DashboardSalesController],
      providers: [
        { provide: SalesService, useValue: salesService },
        { provide: CatalogService, useValue: catalogService },
        {
          provide: PlatformOscuCallbackService,
          useValue: {
            postOutcomeWithCorrelation: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: Sync2BooksCorrelationPersistenceService,
          useValue: {
            patchComplianceDocument: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MailerService,
          useValue: { send: jest.fn().mockResolvedValue({ sent: false, reason: 'stub' }) },
        },
        {
          // DashboardSalesController fires the eTIMS receipt push-back after a
          // retry (POST /dashboard-api/sales/sync); nothing in this spec's
          // credit-note scenarios reaches it.
          provide: InvoiceReceiptPushbackService,
          useValue: {
            notifyForRetriedDocuments: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    })
      // These specs exercise controller behaviour, not authorization; the
      // guards' own specs cover the tenant checks.
      .overrideGuard(MerchantOwnershipGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SaleOwnershipGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AssertedMerchantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    apiController = module.get(ApiSalesController);
    dashboardController = module.get(DashboardSalesController);
  });

  it('builds express credit note input from saleId (submit=false)', async () => {
    await apiController.createExpressCreditNote(
      {
        merchantId: 'merchant-1',
        branchId: 'branch-1',
        saleId: 'sale-1',
        traderInvoiceNumber: 'CN-1',
        returnDate: '2026-02-21',
      },
      emptyReq,
      'false',
    );

    expect(salesService.createDocument).toHaveBeenCalledTimes(1);
    expect(salesService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        branchId: 'branch-1',
        sourceSystem: SourceSystem.API,
        sourceDocumentId: 'CN-1',
        documentType: DocumentType.CREDIT_NOTE,
        documentNumber: 'CN-1',
        originalDocumentNumber: 'INV-123',
        originalSaleId: 'sale-1',
        saleDate: '2026-02-21',
        receiptTypeCode: 'R',
      }),
      { enqueueProcessing: false },
    );

    expect(salesService.validateDocument).not.toHaveBeenCalled();
    expect(salesService.prepareDocument).not.toHaveBeenCalled();
    expect(salesService.submitDocument).not.toHaveBeenCalled();
  });

  it('runs pipeline when submit=true', async () => {
    await dashboardController.createExpressCreditNote(
      {
        merchantId: 'merchant-1',
        branchId: 'branch-1',
        saleId: 'sale-1',
        traderInvoiceNumber: 'CN-2',
        returnDate: '2026-02-21',
      },
      'true',
    );

    expect(salesService.validateDocument).toHaveBeenCalledWith('cn-1');
    expect(salesService.prepareDocument).toHaveBeenCalledWith('cn-1');
    expect(salesService.submitDocument).toHaveBeenCalledWith('cn-1');
  });

  it('tags a dashboard-created express credit note as MANUAL, not API -- a human made this in the dashboard, not a merchant integration (previously mislabeled API, indistinguishable from a real API-sourced document in reporting)', async () => {
    await dashboardController.createExpressCreditNote(
      {
        merchantId: 'merchant-1',
        branchId: 'branch-1',
        saleId: 'sale-1',
        traderInvoiceNumber: 'CN-4',
        returnDate: '2026-02-21',
      },
      'false',
    )

    expect(salesService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSystem: SourceSystem.MANUAL }),
      { enqueueProcessing: false },
    )
  })

  it('rejects non-ACCEPTED sale', async () => {
    salesService.getDocument.mockResolvedValueOnce({
      document: { ...acceptedSale, complianceStatus: ComplianceStatus.DRAFT },
    });

    await expect(
      apiController.createExpressCreditNote(
        {
          merchantId: 'merchant-1',
          branchId: 'branch-1',
          saleId: 'sale-1',
          traderInvoiceNumber: 'CN-3',
          returnDate: '2026-02-21',
        },
        emptyReq,
        'false',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tags a plain dashboard-created sale as MANUAL, not API', async () => {
    await dashboardController.createSale(
      {
        merchantId: 'merchant-1',
        branchId: 'branch-1',
        saleDate: '2026-02-20',
        traderInvoiceNumber: 'INV-99',
        receiptTypeCode: 'S',
        paymentTypeCode: '01',
        invoiceStatusCode: '02',
        items: [
          {
            id: 'item-1',
            quantity: 1,
            unitPrice: 100,
            taxCategory: 'VAT_STANDARD',
            taxAmount: 16,
          },
        ],
      },
      'false',
    )

    expect(salesService.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSystem: SourceSystem.MANUAL }),
      { enqueueProcessing: false },
    )
  })

  describe('invoiceType (tax-exempt sales)', () => {
    const exemptBody = {
      merchantId: 'merchant-1',
      branchId: 'branch-1',
      saleDate: '2026-02-20',
      traderInvoiceNumber: 'INV-EXEMPT-1',
      receiptTypeCode: 'S',
      paymentTypeCode: '01',
      invoiceStatusCode: '02',
      invoiceType: InvoiceType.EXEMPT,
      items: [
        {
          id: 'item-1',
          quantity: 2,
          unitPrice: 500,
          // A caller sending real VAT alongside EXEMPT is exactly the case
          // this override exists for -- it must never reach KRA.
          taxCategory: 'VAT_STANDARD',
          taxAmount: 160,
        },
      ],
    };

    it('defaults to NORMAL and leaves lines untouched when invoiceType is omitted', async () => {
      await dashboardController.createSale(
        {
          merchantId: 'merchant-1',
          branchId: 'branch-1',
          saleDate: '2026-02-20',
          traderInvoiceNumber: 'INV-NORMAL-1',
          receiptTypeCode: 'S',
          paymentTypeCode: '01',
          invoiceStatusCode: '02',
          items: [
            { id: 'item-1', quantity: 1, unitPrice: 100, taxCategory: 'VAT_STANDARD', taxAmount: 16 },
          ],
        },
        'false',
      );

      expect(salesService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceType: InvoiceType.NORMAL,
          totalTax: 16,
          lines: [expect.objectContaining({ taxCategory: 'VAT_STANDARD', taxAmount: 16 })],
        }),
        { enqueueProcessing: false },
      );
    });

    // The security-relevant case: even though the client sent VAT_STANDARD /
    // taxAmount 160, EXEMPT on the sale must force every line to 0% before
    // totals are computed and before createDocument is called at all.
    it('dashboard: forces every line to EXEMPT/0 tax and zeroes the totals', async () => {
      await dashboardController.createSale(exemptBody, 'false');

      expect(salesService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceType: InvoiceType.EXEMPT,
          totalTax: 0,
          subtotalAmount: 1000,
          totalAmount: 1000,
          lines: [
            expect.objectContaining({
              itemId: 'item-1',
              taxCategory: 'EXEMPT',
              taxAmount: 0,
              // Without this, the item's own catalog taxTyCd would win
              // downstream and KRA would still be charged real VAT -- see
              // applyInvoiceTypeOverride's doc comment.
              taxTyCdSnapshot: 'A',
            }),
          ],
        }),
        { enqueueProcessing: false },
      );
    });

    it('api: forces every line to EXEMPT/0 tax the same way', async () => {
      await apiController.createSale(exemptBody, emptyReq, 'false');

      expect(salesService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceType: InvoiceType.EXEMPT,
          totalTax: 0,
          lines: [expect.objectContaining({ taxCategory: 'EXEMPT', taxAmount: 0, taxTyCdSnapshot: 'A' })],
        }),
        { enqueueProcessing: false },
      );
    });

    it('an express credit note inherits its original sale’s invoiceType, not the request’s', async () => {
      salesService.getDocument.mockResolvedValueOnce({
        document: { ...acceptedSale, invoiceType: InvoiceType.EXEMPT },
      });

      await apiController.createExpressCreditNote(
        {
          merchantId: 'merchant-1',
          branchId: 'branch-1',
          saleId: 'sale-1',
          traderInvoiceNumber: 'CN-EXEMPT-1',
          returnDate: '2026-02-21',
        },
        emptyReq,
        'false',
      );

      expect(salesService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceType: InvoiceType.EXEMPT }),
        { enqueueProcessing: false },
      );
    });

    // Independent of invoiceType: even a NORMAL sale's own real tax code
    // (VAT_STANDARD/B here) must carry over so a credit note reverses the
    // sale as it was actually charged, not as the catalog item is today.
    it("copies the original sale's own taxTyCdSnapshot onto the credit note's lines", async () => {
      await apiController.createExpressCreditNote(
        {
          merchantId: 'merchant-1',
          branchId: 'branch-1',
          saleId: 'sale-1',
          traderInvoiceNumber: 'CN-SNAPSHOT-1',
          returnDate: '2026-02-21',
        },
        emptyReq,
        'false',
      );

      expect(salesService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [expect.objectContaining({ taxTyCdSnapshot: 'B' })],
        }),
        { enqueueProcessing: false },
      );
    });

    it('an express credit note off a NORMAL sale stays NORMAL', async () => {
      await apiController.createExpressCreditNote(
        {
          merchantId: 'merchant-1',
          branchId: 'branch-1',
          saleId: 'sale-1',
          traderInvoiceNumber: 'CN-NORMAL-1',
          returnDate: '2026-02-21',
        },
        emptyReq,
        'false',
      );

      expect(salesService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceType: InvoiceType.NORMAL }),
        { enqueueProcessing: false },
      );
    });
  });

  describe('EXEMPT sales must only include items whose KRA classification is Exempt', () => {
    const body = {
      merchantId: 'merchant-1',
      branchId: 'branch-1',
      saleDate: '2026-02-20',
      traderInvoiceNumber: 'INV-EXEMPT-GATE-1',
      receiptTypeCode: 'S',
      paymentTypeCode: '01',
      invoiceStatusCode: '02',
      invoiceType: InvoiceType.EXEMPT,
      items: [{ id: 'item-1', quantity: 1, unitPrice: 100, taxCategory: 'VAT_STANDARD', taxAmount: 16 }],
    };

    // Live-corrected 2026-09-28: KRA validates against the item's
    // *classification's* own KRA-defined tax type, not the item's own
    // locally-stored default -- see findItemsIneligibleForExempt's doc
    // comment for the counter-example this replaced a stricter, wrong check
    // with.
    it('refuses the sale before creating anything when the item’s classification is taxed, not Exempt', async () => {
      catalogService.getItemById.mockResolvedValueOnce({
        id: 'item-1',
        name: 'Grilled Goat Ribs',
        classificationCode: '1010150800',
      });
      catalogService.getItemClassification.mockResolvedValueOnce({
        itemClsCd: '1010150800',
        taxTyCd: 'B',
      });

      await expect(dashboardController.createSale(body, 'false')).rejects.toThrow(BadRequestException);
      expect(salesService.createDocument).not.toHaveBeenCalled();
    });

    it('names the offending item in the error', async () => {
      catalogService.getItemById.mockResolvedValueOnce({
        id: 'item-1',
        name: 'Grilled Goat Ribs',
        classificationCode: '1010150800',
      });
      catalogService.getItemClassification.mockResolvedValueOnce({
        itemClsCd: '1010150800',
        taxTyCd: 'B',
      });

      const error = await dashboardController.createSale(body, 'false').catch((e) => e);
      expect(error.getResponse().message).toContain('Grilled Goat Ribs');
      expect(error.getResponse().items).toEqual(['item-1']);
    });

    it('proceeds when the item’s classification is itself Exempt', async () => {
      catalogService.getItemById.mockResolvedValueOnce({
        id: 'item-1',
        name: 'Facility Interest Charge',
        classificationCode: '1000000000',
      });
      catalogService.getItemClassification.mockResolvedValueOnce({
        itemClsCd: '1000000000',
        taxTyCd: 'A',
      });

      await expect(apiController.createSale(body, emptyReq, 'false')).resolves.toBeDefined();
      expect(salesService.createDocument).toHaveBeenCalled();
    });

    // No positive KRA evidence either way -- refusing would block a possibly
    // legitimate sale for nothing.
    it('proceeds when the classification never synced locally', async () => {
      catalogService.getItemById.mockResolvedValueOnce({
        id: 'item-1',
        name: 'New Item',
        classificationCode: '9999999999',
      });
      catalogService.getItemClassification.mockResolvedValueOnce(null);

      await expect(apiController.createSale(body, emptyReq, 'false')).resolves.toBeDefined();
      expect(salesService.createDocument).toHaveBeenCalled();
    });

    it('never runs the check for a NORMAL sale', async () => {
      await apiController.createSale(
        { ...body, invoiceType: InvoiceType.NORMAL },
        emptyReq,
        'false',
      );
      expect(catalogService.getItemById).not.toHaveBeenCalled();
    });
  });
});
