import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { SalesModule } from '../sales/sales.module';
import { DocumentsController } from '../sales/controller/documents.controller';
import { SalesService } from '../sales/application/sales.service';
import { DocumentType } from '../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../shared/domain/enums/source-system.enum';
import { CatalogItemOrmEntity } from '../catalog/infrastructure/persistence/catalog-item.orm-entity';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  let service: SalesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          autoLoadEntities: true,
          synchronize: true,
          logging: false,
        }),
        SalesModule,
      ],
    }).compile();

    controller = module.get<DocumentsController>(DocumentsController);
    service = module.get<SalesService>(SalesService);

    // Seed the catalog for validation (document lines reference itemId = "item-1")
    const repo = module.get<Repository<CatalogItemOrmEntity>>(
      getRepositoryToken(CatalogItemOrmEntity),
    );
    const existing = await repo.findOne({ where: { id: 'item-1' } });
    if (!existing) {
      await repo.save(
        repo.create({
          id: 'item-1',
          merchantId: 'merchant-1',
          externalId: 'ext-item-1',
          name: 'Test Item',
          sku: 'SKU-001',
          itemType: 'GOODS',
          taxCategory: 'VAT_STANDARD',
          classificationCode: '1234567890',
          unitCode: 'EA',
          registrationStatus: 'REGISTERED',
          version: 1,
          lastSyncedAt: new Date(),
        }),
      );
    }
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create and validate flow', () => {
    it('should create document, validate, prepare, submit', async () => {
      const createResult = await service.createDocument({
        merchantId: 'merchant-1',
        branchId: 'branch-1',
        sourceSystem: SourceSystem.API,
        sourceDocumentId: 'inv-001',
        documentType: DocumentType.SALE,
        documentNumber: 'INV-001',
        currency: 'KES',
        exchangeRate: 1,
        subtotalAmount: 100,
        totalTax: 16,
        totalAmount: 116,
        lines: [
          {
            itemId: 'item-1',
            description: 'Test',
            quantity: 1,
            unitPrice: 100,
            taxCategory: 'VAT_STANDARD',
            taxAmount: 16,
          },
        ],
      });

      expect(createResult.created).toBe(true);
      expect(createResult.document.complianceStatus).toBe('DRAFT');

      const validateResult = await service.validateDocument(
        createResult.document.id,
      );
      expect(validateResult.validation.isValid).toBe(true);
      expect(validateResult.transitioned).toBe(true);
      expect(validateResult.document.complianceStatus).toBe('VALIDATED');

      await service.prepareDocument(createResult.document.id);
      const submitResult = await service.submitDocument(
        createResult.document.id,
      );

      expect(submitResult.success).toBe(true);
      expect(submitResult.receiptNumber).toBeDefined();
      expect(submitResult.document.complianceStatus).toBe('ACCEPTED');
    });
  });
});
