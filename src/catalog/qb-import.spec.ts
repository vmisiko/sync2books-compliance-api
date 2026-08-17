import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog.module';
import { CatalogService } from './api/catalog.service';
import { mapQuickBooksItemToRegisterItemInput } from './infrastructure/quickbooks/qb-item.mapper';

describe('QB import → Catalog item registration (matrix)', () => {
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
    service = module.get<CatalogService>(CatalogService);
  });

  it('1) Inventory + VAT standard + classification/unit known → creates', async () => {
    const input = mapQuickBooksItemToRegisterItemInput({
      merchantId: 'm1',
      qbItem: {
        Id: 'qb-1',
        Name: 'Inventory Widget',
        Type: 'Inventory',
        SalesTaxCodeRef: { value: '1', name: 'VAT Standard' },
      },
      classificationCodeOverride: '14111400',
      qtyUnitCdOverride: 'NO',
      packagingUnitCdOverride: 'NT',
    });

    const res = await service.registerItem(input);
    expect(res.created).toBe(true);
    expect(res.item.externalId).toBe('qb-1');
    expect(res.item.taxTyCd).toBe('B');
    expect(res.item.unitCode).toBe('NO');
    expect(res.item.packagingUnitCode).toBe('NT');
  });

  it('2) Service + exempt + classification/unit known → creates', async () => {
    const input = mapQuickBooksItemToRegisterItemInput({
      merchantId: 'm1',
      qbItem: {
        Id: 'qb-2',
        Name: 'Consulting Hours',
        Type: 'Service',
        SalesTaxCodeRef: { value: '2', name: 'Exempt' },
      },
      classificationCodeOverride: '14111400',
      qtyUnitCdOverride: 'NO',
      packagingUnitCdOverride: 'NT',
    });

    const res = await service.registerItem(input);
    expect(res.created).toBe(true);
    expect(res.item.taxTyCd).toBe('A');
    expect(res.item.productTypeCode).toBe('3');
  });

  it('3) NonInventory + missing tax → tax falls back to the global default; unit is still required per item', async () => {
    const input = mapQuickBooksItemToRegisterItemInput({
      merchantId: 'm1',
      qbItem: {
        Id: 'qb-3',
        Name: 'Office Supplies',
        Type: 'NonInventory',
        // no SalesTaxCodeRef -> internalTaxCategory OTHER
      },
      classificationCodeOverride: '14111400',
      // Quantity/packaging unit has no category fallback anymore -- always
      // per item, so this item still needs its own override even though
      // tax can fall back to OTHER's global default.
      qtyUnitCdOverride: 'NO',
      packagingUnitCdOverride: 'NT',
    });

    const res = await service.registerItem(input);
    expect(res.created).toBe(true);
    // taxCategory OTHER -> taxTyCd D (global default seed)
    expect(res.item.taxTyCd).toBe('D');
    expect(res.item.unitCode).toBe('NO');
    expect(res.item.packagingUnitCode).toBe('NT');
  });

  it('4) Missing classification mapping → errors with Needs mapping message', async () => {
    const input = mapQuickBooksItemToRegisterItemInput({
      merchantId: 'm2',
      qbItem: {
        Id: 'qb-4',
        Name: 'Unknown Classification Item',
        Type: 'Inventory',
        SalesTaxCodeRef: { value: '1', name: 'VAT Standard' },
      },
      // no classificationCodeOverride, but unit is supplied so the
      // classification check is what actually fails here.
      qtyUnitCdOverride: 'NO',
      packagingUnitCdOverride: 'NT',
    });

    await expect(service.registerItem(input)).rejects.toThrow(
      /Missing classification mapping/i,
    );
  });

  it('4b) Missing qtyUnitCd/packagingUnitCd override → errors per field, with no category to fall back to', async () => {
    const input = mapQuickBooksItemToRegisterItemInput({
      merchantId: 'm2',
      qbItem: {
        Id: 'qb-4b',
        Name: 'No Unit Item',
        Type: 'Inventory',
        SalesTaxCodeRef: { value: '1', name: 'VAT Standard' },
      },
      classificationCodeOverride: '14111400',
      // no qtyUnitCdOverride/packagingUnitCdOverride
    });

    await expect(service.registerItem(input)).rejects.toThrow(
      /Missing qtyUnitCd/i,
    );
  });

  it('5) Same QB Id imported twice → updates (version increments), does not duplicate', async () => {
    const first = mapQuickBooksItemToRegisterItemInput({
      merchantId: 'm3',
      qbItem: {
        Id: 'qb-5',
        Name: 'Dup Item',
        Type: 'Inventory',
        SalesTaxCodeRef: { value: '1', name: 'VAT Standard' },
      },
      classificationCodeOverride: '14111400',
      qtyUnitCdOverride: 'NO',
      packagingUnitCdOverride: 'NT',
    });

    const r1 = await service.registerItem(first);
    expect(r1.created).toBe(true);
    expect(r1.item.version).toBe(1);

    const r2 = await service.registerItem({
      ...first,
      name: 'Dup Item (renamed)',
    });
    expect(r2.created).toBe(false);
    expect(r2.item.version).toBe(2);

    const listed = await service.listItems('m3');
    const matches = listed.items.filter((i) => i.externalId === 'qb-5');
    expect(matches.length).toBe(1);
  });
});
