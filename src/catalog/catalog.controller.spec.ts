import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog.module';
import { CatalogController } from './api/catalog.controller';
import { CatalogService } from './api/catalog.service';
import { ItemType } from '../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../shared/domain/enums/tax-category.enum';

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
      itemType: ItemType.GOODS,
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
      itemType: ItemType.SERVICE,
      taxCategory: TaxCategory.VAT_STANDARD,
      unitCode: 'NO',
      packagingUnitCode: 'NT',
      classificationCode: '14111400',
      taxTyCd: 'B',
      productTypeCode: '3',
      unitPrice: 2500,
      originCountry: 'KE',
      isStockItem: false,
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
      itemType: ItemType.SERVICE,
      taxCategory: TaxCategory.VAT_STANDARD,
      unitCode: 'NO',
      packagingUnitCode: 'NT',
      classificationCode: '14111400',
      taxTyCd: 'B',
      productTypeCode: '3',
      isStockItem: false,
    });
    expect(second.created).toBe(true);
    expect(second.item.id).not.toBe(first.item.id);
    expect(second.item.unitPrice).toBeNull();

    const listed = await service.listItems('merchant-manual');
    expect(listed.items.filter((i) => i.name === 'Consulting Hours').length).toBe(2);
  });
});
