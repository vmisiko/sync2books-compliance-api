import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { CatalogModule } from './catalog.module';
import { CatalogService } from './api/catalog.service';
import type { RegisterItemInput } from './application/use-cases/register-item.usecase';
import { ItemType } from '../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../shared/domain/enums/tax-category.enum';
import { ClassificationMappingOrmEntity } from '../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';
import { SourceSystem } from '../shared/domain/enums/source-system.enum';
import { MappingStatus } from '../shared/domain/enums/mapping-status.enum';
import { CATALOG_ITEM_REPO } from '../shared/tokens';
import type { ICatalogItemRepository } from './domain/ports/item-repository.port';

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
  let clsRepo: Repository<ClassificationMappingOrmEntity>;
  let itemRepo: ICatalogItemRepository;

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
    clsRepo = module.get(getRepositoryToken(ClassificationMappingOrmEntity));
    itemRepo = module.get<ICatalogItemRepository>(CATALOG_ITEM_REPO);
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

  /**
   * Regression: two ERPs connected for the same merchant routinely assign
   * the same small numeric externalId to two completely unrelated products
   * (Odoo's `product.product` ids and QuickBooks' `Item.Id` are both
   * independent, small, sequential integers). Before this fix, registering
   * an Odoo item with the same externalId as an already-registered
   * QuickBooks item would upsert into that QuickBooks item's own row
   * (findByMerchantAndExternalId had no sourceSystem filter, and the new-row
   * id was `item-{merchantId}-{externalId}` with no sourceSystem baked in),
   * corrupting an already-KRA-registered item's local classification/name
   * and resetting its registrationStatus to PENDING.
   */
  it('6) two ERPs sharing the same externalId register as two distinct items, not one overwriting the other', async () => {
    const qb: RegisterItemInput = {
      merchantId: 'm6',
      externalId: '2',
      sourceSystem: SourceSystem.QUICKBOOKS,
      name: 'Hp Monitor',
      itemType: ItemType.SERVICE,
      taxCategory: TaxCategory.VAT_STANDARD,
      classificationCode: '14111400',
      unitCode: 'NO',
      packagingUnitCode: 'NT',
    };
    const odoo: RegisterItemInput = {
      merchantId: 'm6',
      externalId: '2',
      sourceSystem: SourceSystem.ODOO,
      name: 'Bacon Burger',
      itemType: ItemType.GOODS,
      taxCategory: TaxCategory.VAT_STANDARD,
      classificationCode: '20141600',
      unitCode: 'NO',
      packagingUnitCode: 'NT',
    };

    const qbResult = await service.registerItem(qb);
    const odooResult = await service.registerItem(odoo);

    expect(qbResult.created).toBe(true);
    expect(odooResult.created).toBe(true);
    expect(qbResult.item.id).not.toBe(odooResult.item.id);
    expect(qbResult.item.name).toBe('Hp Monitor');
    expect(qbResult.item.classificationCode).toBe('14111400');
    expect(odooResult.item.name).toBe('Bacon Burger');
    expect(odooResult.item.classificationCode).toBe('20141600');

    // Re-registering the QuickBooks item again (e.g. a re-pull) must still
    // update its own row, not create a third one or touch Odoo's.
    const qbAgain = await service.registerItem({ ...qb, name: 'Hp Monitor (renamed)' });
    expect(qbAgain.created).toBe(false);
    expect(qbAgain.item.id).toBe(qbResult.item.id);

    const listed = await service.listItems('m6');
    expect(listed.items.filter((i) => i.externalId === '2')).toHaveLength(2);
    const odooRow = listed.items.find((i) => i.id === odooResult.item.id);
    expect(odooRow?.name).toBe('Bacon Burger');
    expect(odooRow?.classificationCode).toBe('20141600');
  });

  /**
   * Same collision class, one layer down: classification_mappings rows are
   * also keyed by (merchantId, matchType, matchValue) with no sourceSystem
   * scoping before this fix, so auto-resolution (no classificationCode
   * override supplied) would pick up whichever ERP's row existed first for
   * a colliding externalId.
   */
  it('7) classification auto-resolution is scoped by sourceSystem, not just externalId', async () => {
    await clsRepo.save(
      clsRepo.create({
        id: 'clsmap-qb',
        merchantId: 'm7',
        matchType: 'EXTERNAL_ID',
        matchValue: '9',
        itemType: ItemType.GOODS,
        itemClsCd: '14111400',
        priority: 100,
        source: 'merchant_override',
        active: true,
        sourceSystem: SourceSystem.QUICKBOOKS,
        status: MappingStatus.MAPPED,
      }),
    );
    await clsRepo.save(
      clsRepo.create({
        id: 'clsmap-odoo',
        merchantId: 'm7',
        matchType: 'EXTERNAL_ID',
        matchValue: '9',
        itemType: ItemType.GOODS,
        itemClsCd: '20141600',
        priority: 100,
        source: 'merchant_override',
        active: true,
        sourceSystem: SourceSystem.ODOO,
        status: MappingStatus.MAPPED,
      }),
    );

    const odooResult = await service.registerItem({
      merchantId: 'm7',
      externalId: '9',
      sourceSystem: SourceSystem.ODOO,
      name: 'Odoo Item 9',
      itemType: ItemType.GOODS,
      taxCategory: TaxCategory.VAT_STANDARD,
      unitCode: 'NO',
      packagingUnitCode: 'NT',
    });

    expect(odooResult.item.classificationCode).toBe('20141600');
  });

  /**
   * Regression: a re-pull (main API's own item cache refreshing, or a human
   * clicking "Pull from ERP" again) reprocesses every item every time, not
   * just changed ones. Before this fix, re-registering an item with
   * identical data unconditionally reset registrationStatus to PENDING and
   * wiped lastSyncedAt/lastSyncResultCd -- so simply pulling again (e.g. to
   * pick up one genuinely new item) silently discarded every already-
   * REGISTERED item's KRA sync history and staged it for a pointless
   * resync, risking a real, unnecessary saveItem call reusing the same
   * itemCd the next time someone clicked Sync.
   */
  it('8) re-registering an already-REGISTERED item with unchanged data leaves it REGISTERED, not reset to PENDING', async () => {
    const input: RegisterItemInput = {
      merchantId: 'm8',
      externalId: 'ext-8',
      sourceSystem: SourceSystem.QUICKBOOKS,
      name: 'Stable Item',
      itemType: ItemType.GOODS,
      taxCategory: TaxCategory.VAT_STANDARD,
      classificationCode: '14111400',
      unitCode: 'NO',
      packagingUnitCode: 'NT',
    };

    const created = await service.registerItem(input);
    expect(created.created).toBe(true);
    // Simulate a real KRA saveItem success, the way syncItemsToEtims would.
    const registered = await itemRepo.save({
      ...created.item,
      registrationStatus: 'REGISTERED',
      etimsItemCode: 'KE2NTNO0000099',
      lastSyncResultCd: '000',
      lastSyncResultMsg: 'Successfully Saved.',
      lastSyncedAt: new Date(),
    });
    expect(registered.registrationStatus).toBe('REGISTERED');

    // A re-pull with byte-for-byte identical data must not touch sync state.
    const rePulled = await service.registerItem({ ...input });
    expect(rePulled.created).toBe(false);
    expect(rePulled.item.registrationStatus).toBe('REGISTERED');
    expect(rePulled.item.etimsItemCode).toBe('KE2NTNO0000099');
    expect(rePulled.item.version).toBe(registered.version);

    // A re-pull that DOES change something KRA-relevant still resyncs.
    const rePulledChanged = await service.registerItem({
      ...input,
      name: 'Stable Item (renamed)',
    });
    expect(rePulledChanged.item.registrationStatus).toBe('PENDING');
    expect(rePulledChanged.item.lastSyncedAt).toBeNull();
    expect(rePulledChanged.item.version).toBe(registered.version + 1);
  });
});
