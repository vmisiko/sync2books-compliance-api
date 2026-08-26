import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ClassificationResolverTypeOrm } from './classification-resolver.typeorm';
import { ClassificationMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';
import { TaxMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';
import { ItemType } from '../../shared/domain/enums/item-type.enum';
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';
import { MappingStatus } from '../../shared/domain/enums/mapping-status.enum';

/**
 * Covers ClassificationResolverTypeOrm.resolveClassification's `method`
 * field -- which strategy in the real resolution chain (EXPLICIT ->
 * EXTERNAL_ID -> SKU -> NAME_CONTAINS -> DEFAULT, see
 * classification-resolver.port.ts's ClassificationMethod doc comment)
 * actually produced classificationCode. This is what
 * CatalogItem.needsClassificationReview is derived from downstream, so each
 * branch needs its own coverage rather than just the resulting code.
 */
describe('ClassificationResolverTypeOrm — method resolution', () => {
  let resolver: ClassificationResolverTypeOrm;
  let clsRepo: Repository<ClassificationMappingOrmEntity>;

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
        TypeOrmModule.forFeature([
          ClassificationMappingOrmEntity,
          TaxMappingOrmEntity,
        ]),
      ],
      providers: [ClassificationResolverTypeOrm],
    }).compile();

    await module.init();
    resolver = module.get(ClassificationResolverTypeOrm);
    clsRepo = module.get(getRepositoryToken(ClassificationMappingOrmEntity));
  });

  function baseParams(overrides: Partial<Parameters<ClassificationResolverTypeOrm['resolveClassification']>[0]> = {}) {
    return {
      merchantId: 'm1',
      itemType: ItemType.GOODS,
      unitCode: 'NO',
      packagingUnitCode: 'NT',
      taxTyCd: 'B',
      ...overrides,
    };
  }

  it('EXPLICIT: caller-supplied classificationCode skips the lookup chain entirely', async () => {
    const result = await resolver.resolveClassification(
      baseParams({ classificationCode: '99999999', itemName: 'Anything' }),
    );

    expect(result.classificationCode).toBe('99999999');
    expect(result.method).toBe('EXPLICIT');
  });

  it('EXTERNAL_ID: matches an active mapping keyed on externalId', async () => {
    await clsRepo.save(
      clsRepo.create({
        id: 'cls-ext',
        merchantId: 'm1',
        matchType: 'EXTERNAL_ID',
        matchValue: 'ext-1',
        itemType: ItemType.GOODS,
        itemClsCd: '14111400',
        priority: 100,
        source: 'merchant_override',
        active: true,
        sourceSystem: null,
        status: MappingStatus.MAPPED,
      }),
    );

    const result = await resolver.resolveClassification(
      baseParams({ externalId: 'ext-1', sku: 'sku-should-not-match', itemName: 'Widget' }),
    );

    expect(result.classificationCode).toBe('14111400');
    expect(result.method).toBe('EXTERNAL_ID');
  });

  it('SKU: falls through to a SKU match when externalId has no active mapping', async () => {
    await clsRepo.save(
      clsRepo.create({
        id: 'cls-sku',
        merchantId: 'm1',
        matchType: 'SKU',
        matchValue: 'SKU-1',
        itemType: ItemType.GOODS,
        itemClsCd: '20141600',
        priority: 100,
        source: 'merchant_override',
        active: true,
        sourceSystem: null,
        status: MappingStatus.MAPPED,
      }),
    );

    const result = await resolver.resolveClassification(
      baseParams({ externalId: 'no-mapping-for-this-id', sku: 'SKU-1', itemName: 'Widget' }),
    );

    expect(result.classificationCode).toBe('20141600');
    expect(result.method).toBe('SKU');
  });

  it('NAME_CONTAINS: falls through to a fuzzy name match when externalId/sku have no active mapping', async () => {
    // The resolver's query is `matchValue ILIKE '%<itemName>%'` -- matchValue
    // must contain the item's name as a substring, mirroring how
    // MappingSuggestionService actually creates these rows (matchValue:
    // input.itemName).
    await clsRepo.save(
      clsRepo.create({
        id: 'cls-name',
        merchantId: 'm1',
        matchType: 'NAME_CONTAINS',
        matchValue: 'Bacon Burger',
        itemType: ItemType.GOODS,
        itemClsCd: '50202306',
        priority: 100,
        source: 'rule_based',
        active: true,
        sourceSystem: null,
        status: MappingStatus.MAPPED,
      }),
    );

    const result = await resolver.resolveClassification(
      baseParams({ itemName: 'Bacon Burger' }),
    );

    expect(result.classificationCode).toBe('50202306');
    expect(result.method).toBe('NAME_CONTAINS');
  });

  it('DEFAULT: falls back to the merchant\'s placeholder row when nothing else matches', async () => {
    await clsRepo.save(
      clsRepo.create({
        id: 'cls-default',
        merchantId: 'm1',
        matchType: 'NAME_CONTAINS',
        matchValue: '__default__',
        itemType: null,
        itemClsCd: '00000000',
        priority: 999,
        source: 'default',
        active: true,
        sourceSystem: null,
        status: MappingStatus.MAPPED,
      }),
    );

    const result = await resolver.resolveClassification(
      baseParams({ itemName: 'Something Totally Unmapped' }),
    );

    expect(result.classificationCode).toBe('00000000');
    expect(result.method).toBe('DEFAULT');
  });

  it('throws when no strategy matches and there is no DEFAULT placeholder', async () => {
    await expect(
      resolver.resolveClassification(baseParams({ itemName: 'Nothing Matches' })),
    ).rejects.toThrow(/Missing classification mapping/i);
  });

  it('scopes EXTERNAL_ID matches by sourceSystem, not just externalId', async () => {
    await clsRepo.save(
      clsRepo.create({
        id: 'cls-qb',
        merchantId: 'm1',
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

    await expect(
      resolver.resolveClassification(
        baseParams({ externalId: '9', sourceSystem: SourceSystem.ODOO }),
      ),
    ).rejects.toThrow(/Missing classification mapping/i);

    const result = await resolver.resolveClassification(
      baseParams({ externalId: '9', sourceSystem: SourceSystem.QUICKBOOKS }),
    );
    expect(result.method).toBe('EXTERNAL_ID');
  });
});
