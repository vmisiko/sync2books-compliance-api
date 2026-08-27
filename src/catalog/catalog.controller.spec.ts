import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog.module';
import { CatalogController } from './api/catalog.controller';
import { CatalogService } from './api/catalog.service';
import { TaxCategory } from '../shared/domain/enums/tax-category.enum';
import { ComplianceOrganizationApplicationService } from '../compliance-organization/application/compliance-organization.application.service';
import type { IStockRepository } from '../inventory/domain/ports/stock-repository.port';
import { StockRepositoryStub } from '../inventory/infrastructure/stock-repository.stub';
import { STOCK_REPO } from '../shared/tokens';

describe('CatalogController', () => {
  let controller: CatalogController;
  let service: CatalogService;

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
        CatalogModule,
      ],
    }).compile();

    await module.init();

    controller = module.get<CatalogController>(CatalogController);
    service = module.get<CatalogService>(CatalogService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should register and list items', async () => {
    const registered = await service.registerItem({
      merchantId: 'merchant-2',
      externalId: 'ext-001',
      name: 'Widget',
      taxCategory: TaxCategory.VAT_STANDARD,
      unitCode: 'NO',
      packagingUnitCode: 'NT',
      classificationCode: '14111400',
    });
    expect(registered.created).toBe(true);
    expect(registered.item.name).toBe('Widget');

    const listed = await service.listItems('merchant-2');
    expect(listed.items.length).toBeGreaterThanOrEqual(1);
    expect(listed.items.some((i) => i.name === 'Widget')).toBe(true);
  });

  it('registers a manually-created item (no externalId) as a fresh insert each time, with unitPrice/originCountry persisted', async () => {
    const first = await service.registerItem({
      merchantId: 'merchant-manual',
      name: 'Consulting Hours',
      taxCategory: TaxCategory.VAT_STANDARD,
      unitCode: 'NO',
      packagingUnitCode: 'NT',
      classificationCode: '14111400',
      taxTyCd: 'B',
      productTypeCode: '3',
      unitPrice: 2500,
      originCountry: 'KE',
    });
    expect(first.created).toBe(true);
    expect(first.item.externalId).toBeNull();
    expect(first.item.unitPrice).toBe(2500);
    expect(first.item.originCountry).toBe('KE');

    // A second manual registration with the same merchant/name must not be
    // treated as an upsert of the first (no externalId to match against) --
    // it should insert as an entirely separate row.
    const second = await service.registerItem({
      merchantId: 'merchant-manual',
      name: 'Consulting Hours',
      taxCategory: TaxCategory.VAT_STANDARD,
      unitCode: 'NO',
      packagingUnitCode: 'NT',
      classificationCode: '14111400',
      taxTyCd: 'B',
      productTypeCode: '3',
    });
    expect(second.created).toBe(true);
    expect(second.item.id).not.toBe(first.item.id);
    expect(second.item.unitPrice).toBeNull();

    const listed = await service.listItems('merchant-manual');
    expect(
      listed.items.filter((i) => i.name === 'Consulting Hours').length,
    ).toBe(2);
  });
});

describe('CatalogService: isStockItem derivation + zero-stock auto-seed', () => {
  let service: CatalogService;
  let organization: ComplianceOrganizationApplicationService;
  let stockRepo: IStockRepository;

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
        CatalogModule,
      ],
    })
      // The sqljs test driver used above doesn't support the pessimistic row
      // locking StockTypeOrmRepository.applyDelta() uses (and this file
      // isn't the place to stand up a full mysql-compatible DB), so swap in
      // the same in-memory stub inventory.controller.spec.ts uses for
      // STOCK_REPO. This also exercises CatalogService's best-effort
      // try/catch honestly: with the real TypeORM repo here, the seed call
      // would silently no-op on LockNotSupportedOnGivenDriverError, which
      // would falsely "pass" a test asserting no stock row for Service items.
      .overrideProvider(STOCK_REPO)
      .useClass(StockRepositoryStub)
      .compile();

    await module.init();

    service = module.get<CatalogService>(CatalogService);
    organization = module.get<ComplianceOrganizationApplicationService>(
      ComplianceOrganizationApplicationService,
    );
    stockRepo = module.get<IStockRepository>(STOCK_REPO);
  });

  /** Sets up a tenant + a default branch with a linked sync2books branch id, so seedZeroStockRow's best-effort lookup can resolve. */
  async function setupTenantAndBranch(
    merchantId: string,
    sync2booksBranchId: string,
  ) {
    const { tenant, defaultBranchId } = await organization.upsertTenant({
      sync2booksCompanyId: merchantId,
    });
    await organization.upsertBranch({
      tenantId: tenant.id,
      id: defaultBranchId,
      sync2booksBranchId,
    });
    return { tenantId: tenant.id, branchId: sync2booksBranchId };
  }

  it('registering a Goods item creates a 0-qty stock row in the default branch', async () => {
    const { branchId } = await setupTenantAndBranch(
      'merchant-goods',
      'branch-goods',
    );

    const result = await service.registerItem({
      merchantId: 'merchant-goods',
      externalId: 'ext-goods-1',
      name: 'Steel Beam',
      // Finished Product -- isStockItem is derived from productTypeCode, and
      // this test specifically asserts isStockItem true.
      productTypeCode: '2',
      taxCategory: TaxCategory.VAT_STANDARD,
      unitCode: 'NO',
      packagingUnitCode: 'NT',
      classificationCode: '14111400',
    });

    expect(result.item.isStockItem).toBe(true);
    const stock = await stockRepo.getStock(result.item.id, branchId);
    expect(stock).not.toBeNull();
    expect(stock?.quantityOnHand).toBe(0);
  });

  it('registering a Service item does not create a stock row', async () => {
    const { branchId } = await setupTenantAndBranch(
      'merchant-service',
      'branch-service',
    );

    const result = await service.registerItem({
      merchantId: 'merchant-service',
      externalId: 'ext-service-1',
      name: 'Consulting',
      taxCategory: TaxCategory.VAT_STANDARD,
      unitCode: 'NO',
      packagingUnitCode: 'NT',
      classificationCode: '14111400',
      taxTyCd: 'B',
      productTypeCode: '3',
    });

    expect(result.item.isStockItem).toBe(false);
    const stock = await stockRepo.getStock(result.item.id, branchId);
    expect(stock).toBeNull();
  });

  it('re-registering an existing item recomputes isStockItem from its current productTypeCode, with no override surviving', async () => {
    const { branchId } = await setupTenantAndBranch(
      'merchant-flip',
      'branch-flip',
    );

    const created = await service.registerItem({
      merchantId: 'merchant-flip',
      externalId: 'ext-flip-1',
      name: 'Reclassified Item',
      productTypeCode: '2',
      taxCategory: TaxCategory.VAT_STANDARD,
      unitCode: 'NO',
      packagingUnitCode: 'NT',
      classificationCode: '14111400',
    });
    expect(created.item.isStockItem).toBe(true);
    expect(
      (await stockRepo.getStock(created.item.id, branchId))?.quantityOnHand,
    ).toBe(0);

    // Re-register the same external item as a Service -- isStockItem must
    // flip to false purely from productTypeCode, with no override mechanism
    // to pin the old value.
    const updated = await service.registerItem({
      merchantId: 'merchant-flip',
      externalId: 'ext-flip-1',
      name: 'Reclassified Item',
      taxCategory: TaxCategory.VAT_STANDARD,
      unitCode: 'NO',
      packagingUnitCode: 'NT',
      classificationCode: '14111400',
      taxTyCd: 'B',
      productTypeCode: '3',
    });
    expect(updated.created).toBe(false);
    expect(updated.item.id).toBe(created.item.id);
    expect(updated.item.isStockItem).toBe(false);
  });
});
