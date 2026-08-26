import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CatalogModule } from './catalog.module';
import { CatalogService } from './api/catalog.service';
import type { RegisterItemInput } from './application/use-cases/register-item.usecase';
import { ItemType } from '../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../shared/domain/enums/tax-category.enum';
import { SourceSystem } from '../shared/domain/enums/source-system.enum';
import { CATALOG_ITEM_REPO } from '../shared/tokens';
import type { ICatalogItemRepository } from './domain/ports/item-repository.port';

/**
 * Covers updateManualItem -- the edit-by-id path added so a manually-created
 * item (no externalId) can have a bad classification/unit code corrected
 * directly, since registerItem's externalId-keyed upsert has nothing to
 * match a manual item against and would otherwise insert a duplicate row.
 */
describe('CatalogService.updateManualItem', () => {
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

  async function registerManualItem(
    overrides: Partial<RegisterItemInput> = {},
  ) {
    const input: RegisterItemInput = {
      merchantId: 'm1',
      name: 'Macbook Pro',
      itemType: ItemType.GOODS,
      taxCategory: TaxCategory.VAT_STANDARD,
      classificationCode: '1010151800',
      unitCode: 'KG',
      packagingUnitCode: 'BX', // KRA rejects this -- not a real pkgUnitCd
      ...overrides,
    };
    return service.registerItem(input);
  }

  it('corrects a bad packagingUnitCode in place, without creating a second row', async () => {
    const { item: created } = await registerManualItem();
    expect(created.externalId).toBeNull();
    // A manually-created item always supplies its own classificationCode
    // (the Add Item form requires it), so the resolver never has to search
    // for one -- see classificationCode/EXPLICIT tests below.
    expect(created.classificationMethod).toBe('EXPLICIT');
    expect(created.needsClassificationReview).toBe(false);

    const updated = await service.updateManualItem({
      itemId: created.id,
      merchantId: 'm1',
      packagingUnitCode: 'BQ', // a real KRA code
    });

    expect(updated.id).toBe(created.id);
    expect(updated.packagingUnitCode).toBe('BQ');
    // Untouched fields survive.
    expect(updated.classificationCode).toBe('1010151800');
    expect(updated.unitCode).toBe('KG');
    expect(updated.name).toBe('Macbook Pro');
    // Editing stages it for a resync, mirroring registerItem's own "changed" behavior.
    expect(updated.registrationStatus).toBe('PENDING');
    expect(updated.version).toBe(created.version + 1);

    const listed = await service.listItems('m1');
    expect(listed.items.filter((i) => i.name === 'Macbook Pro')).toHaveLength(
      1,
    );
  });

  it('rejects editing an ERP-sourced item (has externalId) -- fix it at the source or via classification override instead', async () => {
    const { item: created } = await registerManualItem({
      externalId: 'qb-1',
      sourceSystem: SourceSystem.QUICKBOOKS,
    });

    await expect(
      service.updateManualItem({
        itemId: created.id,
        merchantId: 'm1',
        packagingUnitCode: 'BQ',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects editing an item that is already REGISTERED with KRA', async () => {
    const { item: created } = await registerManualItem();
    // Simulate a real KRA saveItem success, the way syncItemsToEtims would.
    await itemRepo.save({
      ...created,
      registrationStatus: 'REGISTERED',
      etimsItemCode: 'KE2BQKG0000001',
    });

    await expect(
      service.updateManualItem({
        itemId: created.id,
        merchantId: 'm1',
        packagingUnitCode: 'BQ',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when no field to update is supplied', async () => {
    const { item: created } = await registerManualItem();

    await expect(
      service.updateManualItem({ itemId: created.id, merchantId: 'm1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown item id', async () => {
    await expect(
      service.updateManualItem({
        itemId: 'does-not-exist',
        merchantId: 'm1',
        packagingUnitCode: 'BQ',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects an item id belonging to a different merchant', async () => {
    const { item: created } = await registerManualItem();

    await expect(
      service.updateManualItem({
        itemId: created.id,
        merchantId: 'someone-elses-merchant',
        packagingUnitCode: 'BQ',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  /**
   * A manually-created item always resolves through the EXPLICIT strategy --
   * both createItem's initial classificationCode and updateManualItem's
   * carried-forward `input.classificationCode ?? existing.classificationCode`
   * are always concrete strings, so resolveClassification's lookup chain
   * never runs for this usecase. Confirms classificationMethod/
   * needsClassificationReview stay correct across an edit, including one
   * that doesn't touch classificationCode at all.
   */
  it('editing a manual item without touching classificationCode keeps classificationMethod EXPLICIT', async () => {
    const { item: created } = await registerManualItem();

    const updated = await service.updateManualItem({
      itemId: created.id,
      merchantId: 'm1',
      name: 'Macbook Pro 16"',
    });

    expect(updated.classificationCode).toBe('1010151800');
    expect(updated.classificationMethod).toBe('EXPLICIT');
    expect(updated.needsClassificationReview).toBe(false);
  });

  it('editing a manual item with a new classificationCode override still records EXPLICIT', async () => {
    const { item: created } = await registerManualItem();

    const updated = await service.updateManualItem({
      itemId: created.id,
      merchantId: 'm1',
      classificationCode: '20141600',
    });

    expect(updated.classificationCode).toBe('20141600');
    expect(updated.classificationMethod).toBe('EXPLICIT');
    expect(updated.needsClassificationReview).toBe(false);
  });
});
