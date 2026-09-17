import { createDocument, type CreateDocumentInput } from './create-document.usecase';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';
import type {
  IComplianceDocumentRepository,
  IComplianceItemRepository,
} from '../../../shared/ports/repository.port';
import type { ComplianceDocument } from '../../domain/entities/compliance-document.entity';

function repos(originalSale: Partial<ComplianceDocument> | null) {
  const documentRepo: jest.Mocked<IComplianceDocumentRepository> = {
    save: jest.fn().mockImplementation(async (d: ComplianceDocument) => d),
    findById: jest.fn(),
    findByIdempotencyKey: jest.fn().mockResolvedValue(null),
    findBySourceInvoiceId: jest.fn(),
    findSaleByDocumentNumber: jest.fn().mockResolvedValue(originalSale),
    findByMerchant: jest.fn(),
  };
  const itemRepo: IComplianceItemRepository = {
    findByIds: jest.fn().mockResolvedValue([
      { id: 'item-1', name: 'Grilled Goat Ribs (per kg)', etimsItemCode: 'KE2NTKG0000013' },
    ]),
  };
  return { documentRepo, itemRepo };
}

function input(overrides: Partial<CreateDocumentInput>): CreateDocumentInput {
  return {
    merchantId: 'merchant-1',
    branchId: '00',
    sourceSystem: SourceSystem.API,
    sourceDocumentId: 'CN-260917-01',
    documentType: DocumentType.CREDIT_NOTE,
    documentNumber: 'CN-260917-01',
    originalDocumentNumber: 'INV-260917-03',
    currency: 'KES',
    exchangeRate: 1,
    subtotalAmount: 2784,
    totalTax: 384,
    totalAmount: 2784,
    lines: [
      {
        itemId: 'item-1',
        description: 'Grilled Goat Ribs (per kg)',
        quantity: 2,
        unitPrice: 1392,
        taxCategory: 'VAT_STANDARD',
        taxAmount: 384,
      },
    ],
    ...overrides,
  };
}

describe('createDocument original sale link', () => {
  // Live 2026-09-17: without the link, orgInvcNo was parsed from "INV-260917-03" as
  // 260917 and KRA rejected the credit note with "orgInvcNo does not exist".
  it('links a credit note to its original sale by trader number, scoped to the merchant', async () => {
    const { documentRepo, itemRepo } = repos({ id: 'doc-original' });

    const { document } = await createDocument(input({}), documentRepo, itemRepo);

    expect(documentRepo.findSaleByDocumentNumber).toHaveBeenCalledWith(
      'merchant-1',
      'INV-260917-03',
    );
    expect(document.originalSaleId).toBe('doc-original');
  });

  it('keeps an explicit originalSaleId without looking anything up', async () => {
    const { documentRepo, itemRepo } = repos({ id: 'doc-other' });

    const { document } = await createDocument(
      input({ originalSaleId: 'doc-explicit' }),
      documentRepo,
      itemRepo,
    );

    expect(documentRepo.findSaleByDocumentNumber).not.toHaveBeenCalled();
    expect(document.originalSaleId).toBe('doc-explicit');
  });

  it('leaves a sale unlinked', async () => {
    const { documentRepo, itemRepo } = repos({ id: 'doc-original' });

    const { document } = await createDocument(
      input({ documentType: DocumentType.SALE, originalDocumentNumber: null }),
      documentRepo,
      itemRepo,
    );

    expect(documentRepo.findSaleByDocumentNumber).not.toHaveBeenCalled();
    expect(document.originalSaleId).toBeNull();
  });
});
