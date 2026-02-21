import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ApiSalesController } from './controller/api-sales.controller';
import { DashboardSalesController } from './controller/dashboard-sales.controller';
import { SalesService } from './application/sales.service';
import { ComplianceStatus } from '../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../shared/domain/enums/source-system.enum';

describe('Express credit note controllers', () => {
  let apiController: ApiSalesController;
  let dashboardController: DashboardSalesController;
  let salesService: {
    getDocument: jest.Mock;
    createDocument: jest.Mock;
    validateDocument: jest.Mock;
    prepareDocument: jest.Mock;
    submitDocument: jest.Mock;
    getNormalizedSaleReport: jest.Mock;
  };

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

  beforeEach(async () => {
    salesService = {
      getDocument: jest.fn().mockResolvedValue({ document: acceptedSale }),
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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiSalesController, DashboardSalesController],
      providers: [{ provide: SalesService, useValue: salesService }],
    }).compile();

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
        'false',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
