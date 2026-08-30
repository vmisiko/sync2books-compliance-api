import { SalesService } from './sales.service';
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';
import type { ComplianceDocument } from '../domain/entities/compliance-document.entity';
import type {
  IComplianceConnectionRepository,
  IComplianceDocumentRepository,
  IComplianceEventRepository,
  IComplianceItemRepository,
} from '../../shared/ports/repository.port';

function baseDocument(
  taxCategory: TaxCategory,
  taxTyCdSnapshot: string | null,
): ComplianceDocument {
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
    customerName: null,
    customerPhoneNumber: null,
    customerEmail: null,
    complianceStatus: ComplianceStatus.ACCEPTED,
    submissionAttempts: 1,
    etimsReceiptNumber: null,
    oscuInvcNo: null,
    idempotencyKey: 'idem-1',
    createdAt: new Date('2026-08-14T10:00:00Z'),
    submittedAt: null,
    lines: [
      {
        id: 'line-1',
        documentId: 'doc-1',
        itemId: 'item-1',
        etimsItemCodeSnapshot: 'IT001',
        description: 'Line',
        quantity: 1,
        unitPrice: 100,
        taxCategory,
        taxAmount: 0,
        classificationCodeSnapshot: '14111400',
        unitCodeSnapshot: 'U',
        packagingUnitCodeSnapshot: 'NT',
        taxTyCdSnapshot,
        productTypeCodeSnapshot: '2',
        createdAt: new Date('2026-08-14T10:00:00Z'),
      },
    ],
  };
}

describe('SalesService.getNormalizedSaleReport tax type resolution', () => {
  function buildService(document: ComplianceDocument): SalesService {
    const documentRepo: IComplianceDocumentRepository = {
      save: jest.fn(),
      findById: jest.fn().mockResolvedValue(document),
      findByIdempotencyKey: jest.fn(),
      findBySourceInvoiceId: jest.fn(),
      findByMerchant: jest.fn(),
    };
    const eventRepo: IComplianceEventRepository = {
      append: jest.fn(),
      findByDocumentId: jest.fn().mockResolvedValue([]),
    };
    const itemRepo: IComplianceItemRepository = {
      findByIds: jest.fn().mockResolvedValue([]),
    };
    const connectionRepo: IComplianceConnectionRepository = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue(null),
    };

    const organizationService = {
      getTenantBySync2booksCompanyId: jest.fn().mockResolvedValue(null),
    };

    return new SalesService(
      documentRepo,
      eventRepo,
      itemRepo,
      connectionRepo,
      {} as never,
      {} as never,
      {} as never,
      organizationService as never,
    );
  }

  // Canonical KRA taxTyCd mapping (matches MappingSuggestionService's
  // TAX_CATEGORY_CODE and the oscu_codes cdCls='04' reference table).
  it.each([
    [TaxCategory.EXEMPT, 'A'],
    [TaxCategory.VAT_STANDARD, 'B'],
    [TaxCategory.VAT_ZERO, 'C'],
  ])(
    'falls back to taxTyCd %s -> %s when no snapshot is present',
    async (taxCategory, expectedCode) => {
      const service = buildService(baseDocument(taxCategory, null));

      const report = await service.getNormalizedSaleReport('doc-1');

      expect(report.itemList[0].taxTypeCode).toBe(expectedCode);
    },
  );

  it('uses the stored snapshot when present, ignoring taxCategory', async () => {
    const service = buildService(baseDocument(TaxCategory.VAT_ZERO, 'B'));

    const report = await service.getNormalizedSaleReport('doc-1');

    expect(report.itemList[0].taxTypeCode).toBe('B');
  });
});
