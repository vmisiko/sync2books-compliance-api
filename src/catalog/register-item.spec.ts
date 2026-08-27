import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog.module';
import { CatalogService } from './api/catalog.service';
import type { RegisterItemInput } from './application/use-cases/register-item.usecase';
import { TaxCategory } from '../shared/domain/enums/tax-category.enum';
import { SourceSystem } from '../shared/domain/enums/source-system.enum';
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
    itemRepo = module.get<ICatalogItemRepository>(CATALOG_ITEM_REPO);
  });

  it('1) GOODS + VAT_STANDARD + classification/unit known → creates', async () => {
    const input: RegisterItemInput = {
      merchantId: 'm1',
      externalId: 'ext-1',
      name: 'Inventory Widget',
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
      productTypeCode: '3',
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

  /**
   * Regression: an item pulled with no approved classification_mappings row
   * (and unitCode/packagingUnitCode never resolved either) used to make
   * resolveClassification throw, which registerItem's caller
   * (DashboardItemsApplicationService.pullItems) only ever logged into a
   * results array nobody read -- the item silently never got a CatalogItem
   * row at all. It must now still register, as an incomplete, visible,
   * fixable PENDING row.
   */
  it('4) Missing classification mapping → still creates, as an incomplete PENDING item needing a mapping', async () => {
    const input: RegisterItemInput = {
      merchantId: 'm2',
      externalId: 'ext-4',
      name: 'Unknown Classification Item',
      taxCategory: TaxCategory.VAT_STANDARD,
      // no classificationCode, but unit is supplied -- classification is
      // what's actually left unresolved here.
      unitCode: 'NO',
      packagingUnitCode: 'NT',
    };

    const res = await service.registerItem(input);
    expect(res.created).toBe(true);
    expect(res.item.classificationCode).toBe('');
    expect(res.item.classificationMethod).toBe('UNRESOLVED');
    expect(res.item.needsClassificationMapping).toBe(true);
    expect(res.item.needsClassificationReview).toBe(true);
    expect(res.item.registrationStatus).toBe('PENDING');
  });

  it('4b) Missing qtyUnitCd/packagingUnitCd override → still creates, as an incomplete PENDING item needing a mapping', async () => {
    const input: RegisterItemInput = {
      merchantId: 'm2',
      externalId: 'ext-4b',
      name: 'No Unit Item',
      taxCategory: TaxCategory.VAT_STANDARD,
      classificationCode: '14111400',
      // no unitCode/packagingUnitCode
    };

    const res = await service.registerItem(input);
    expect(res.created).toBe(true);
    expect(res.item.classificationCode).toBe('14111400');
    expect(res.item.unitCode).toBe('');
    expect(res.item.packagingUnitCode).toBe('');
    expect(res.item.needsClassificationMapping).toBe(true);
    expect(res.item.registrationStatus).toBe('PENDING');
  });

  it('5) Re-importing the same external item updates rather than duplicates (version increments)', async () => {
    const first: RegisterItemInput = {
      merchantId: 'm3',
      externalId: 'ext-5',
      name: 'Dup Item',
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

  /**
   * classificationMethod/needsClassificationReview (see
   * classification-resolver.port.ts's ClassificationMethod and
   * CatalogItem.needsClassificationReview): registerItem must persist
   * whichever strategy classificationResolver.resolveClassification actually
   * used, and needsClassificationReview must reflect it correctly -- false
   * for a confident EXPLICIT value, true for UNRESOLVED. The old
   * EXTERNAL_ID/SKU/NAME_CONTAINS/DEFAULT auto-resolution strategies were
   * removed with classification_mappings on 2026-08-27 (see
   * classification-resolver.port.ts's ClassificationMethod doc comment).
   */
  describe('classificationMethod / needsClassificationReview', () => {
    it('an explicit classificationCode is persisted as EXPLICIT and does not need review', async () => {
      const res = await service.registerItem({
        merchantId: 'm9',
        externalId: 'ext-9a',
        name: 'Explicit Item',
        taxCategory: TaxCategory.VAT_STANDARD,
        classificationCode: '14111400',
        unitCode: 'NO',
        packagingUnitCode: 'NT',
      });

      expect(res.item.classificationMethod).toBe('EXPLICIT');
      expect(res.item.needsClassificationReview).toBe(false);
    });

    it('an omitted classificationCode is persisted as UNRESOLVED and DOES need review', async () => {
      const res = await service.registerItem({
        merchantId: 'm9',
        externalId: 'ext-9b',
        name: 'Unmapped Item',
        taxCategory: TaxCategory.VAT_STANDARD,
        unitCode: 'NO',
        packagingUnitCode: 'NT',
      });

      expect(res.item.classificationCode).toBe('');
      expect(res.item.classificationMethod).toBe('UNRESOLVED');
      expect(res.item.needsClassificationReview).toBe(true);
    });
  });
});
