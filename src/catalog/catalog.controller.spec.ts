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
      internalUnit: 'EA',
      classificationCode: '14111400',
    });
    expect(registered.created).toBe(true);
    expect(registered.item.name).toBe('Widget');

    const listed = await service.listItems('merchant-2');
    expect(listed.items.length).toBeGreaterThanOrEqual(1);
    expect(listed.items.some((i) => i.name === 'Widget')).toBe(true);
  });
});
