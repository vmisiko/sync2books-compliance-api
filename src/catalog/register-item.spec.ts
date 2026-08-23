import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog.module';
import { CatalogService } from './api/catalog.service';
import type { RegisterItemInput } from './application/use-cases/register-item.usecase';
import { ItemType } from '../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../shared/domain/enums/tax-category.enum';

/**
 * Catalog-registration semantics (the KRA-specific part that stays in this
 * repo) — itemType/taxCategory arrive here already resolved, as they now
 * would from main API's `standardized` field (see
 * catalog/infrastructure/main-api/standardized-item.mapper.ts), so these
 * tests build RegisterItemInput literals directly instead of deriving
 * itemType/taxCategory from a raw QuickBooks-shaped item (that ERP-label
 * parsing no longer lives in this repo — see the now-deleted
 * qb-item.mapper.ts / qb-import.spec.ts this file replaces).
 */
describe('registerItem — catalog registration semantics', () => {
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

  it('1) GOODS + VAT_STANDARD + classification/unit known → creates', async () => {
    const input: RegisterItemInput = {
      merchantId: 'm1',
      externalId: 'ext-1',
      name: 'Inventory Widget',
      itemType: ItemType.GOODS,
      taxCategory: TaxCategory.VAT_STANDARD,
      classificationCode: '14111400',
      unitCode: 'NO',
      packagingUnitCode: 'NT',
    };

    const res = await service.registerItem(input);
    expect(res.created).toBe(true);
    expect(res.item.externalId).toBe('ext-1');
    expect(res.item.taxTyCd).toBe('B');
    expect(res.item.unitCode).toBe('NO');
    expect(res.item.packagingUnitCode).toBe('NT');
  });

  it('2) SERVICE + EXEMPT + classification/unit known → creates', async () => {
    const input: RegisterItemInput = {
      merchantId: 'm1',
      externalId: 'ext-2',
      name: 'Consulting Hours',
      itemType: ItemType.SERVICE,
      taxCategory: TaxCategory.EXEMPT,
      classificationCode: '14111400',
      unitCode: 'NO',
      packagingUnitCode: 'NT',
    };

    const res = await service.registerItem(input);
    expect(res.created).toBe(true);
    expect(res.item.taxTyCd).toBe('A');
    expect(res.item.productTypeCode).toBe('3');
  });

  it('3) taxCategory OTHER + classification/unit known → tax falls back to the global default (taxTyCd D); unit is still required per item', async () => {
    const input: RegisterItemInput = {
      merchantId: 'm1',
      externalId: 'ext-3',
      name: 'Office Supplies',
      itemType: ItemType.GOODS,
      taxCategory: TaxCategory.OTHER,
      classificationCode: '14111400',
      // Quantity/packaging unit has no category fallback -- always per
      // item, so this item still needs its own override even though tax
      // falls back to OTHER's global default.
      unitCode: 'NO',
      packagingUnitCode: 'NT',
    };

    const res = await service.registerItem(input);
    expect(res.created).toBe(true);
    // taxCategory OTHER -> taxTyCd D (global default seed)
    expect(res.item.taxTyCd).toBe('D');
    expect(res.item.unitCode).toBe('NO');
    expect(res.item.packagingUnitCode).toBe('NT');
  });

  it('4) Missing classification mapping → errors with Needs mapping message', async () => {
    const input: RegisterItemInput = {
      merchantId: 'm2',
      externalId: 'ext-4',
      name: 'Unknown Classification Item',
      itemType: ItemType.GOODS,
      taxCategory: TaxCategory.VAT_STANDARD,
      // no classificationCode, but unit is supplied so the classification
      // check is what actually fails here.
      unitCode: 'NO',
      packagingUnitCode: 'NT',
    };

    await expect(service.registerItem(input)).rejects.toThrow(
      /Missing classification mapping/i,
    );
  });

  it('4b) Missing qtyUnitCd/packagingUnitCd override → errors per field, with no category to fall back to', async () => {
    const input: RegisterItemInput = {
      merchantId: 'm2',
      externalId: 'ext-4b',
      name: 'No Unit Item',
      itemType: ItemType.GOODS,
      taxCategory: TaxCategory.VAT_STANDARD,
      classificationCode: '14111400',
      // no unitCode/packagingUnitCode
    };

    await expect(service.registerItem(input)).rejects.toThrow(
      /Missing qtyUnitCd/i,
    );
  });

  it('5) Re-importing the same external item updates rather than duplicates (version increments)', async () => {
    const first: RegisterItemInput = {
      merchantId: 'm3',
      externalId: 'ext-5',
      name: 'Dup Item',
      itemType: ItemType.GOODS,
      taxCategory: TaxCategory.VAT_STANDARD,
      classificationCode: '14111400',
      unitCode: 'NO',
      packagingUnitCode: 'NT',
    };

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
    const matches = listed.items.filter((i) => i.externalId === 'ext-5');
    expect(matches.length).toBe(1);
  });
});
