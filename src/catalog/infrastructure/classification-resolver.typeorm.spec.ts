import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ClassificationResolverTypeOrm } from './classification-resolver.typeorm';
import { TaxMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';
import { MappingStatus } from '../../shared/domain/enums/mapping-status.enum';

/**
 * Covers ClassificationResolverTypeOrm.resolveClassification post-2026-08-27
 * simplification: classification/unit/packaging/product-type are always
 * supplied directly by the caller now (or not, resolving to null) -- the
 * old classification_mappings-backed EXTERNAL_ID/SKU/NAME_CONTAINS/DEFAULT
 * lookup chain was removed (see ClassificationMethod's doc comment for why).
 * Tax stays the one field with a real category-based lookup (tax_mappings)
 * that still throws when genuinely unresolvable.
 */
describe('ClassificationResolverTypeOrm', () => {
  let resolver: ClassificationResolverTypeOrm;
  let taxRepo: Repository<TaxMappingOrmEntity>;

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
        TypeOrmModule.forFeature([TaxMappingOrmEntity]),
      ],
      providers: [ClassificationResolverTypeOrm],
    }).compile();

    await module.init();
    resolver = module.get(ClassificationResolverTypeOrm);
    taxRepo = module.get(getRepositoryToken(TaxMappingOrmEntity));
  });

  async function approveTax(taxTyCd: string, internalTaxCategory = 'VAT_STANDARD') {
    await taxRepo.save(
      taxRepo.create({
        id: `taxmap-${internalTaxCategory}`,
        merchantId: 'm1',
        internalTaxCategory,
        taxTyCd,
        version: 1,
        active: true,
        sourceSystem: null,
        status: MappingStatus.MAPPED,
        confidenceScore: null,
        externalValue: null,
        externalId: null,
      }),
    );
  }

  it('EXPLICIT: passes classificationCode/unitCode/packagingUnitCode/productTypeCode straight through when supplied', async () => {
    await approveTax('B');
    const result = await resolver.resolveClassification({
      merchantId: 'm1',
      classificationCode: '99999999',
      unitCode: 'NO',
      packagingUnitCode: 'NT',
      productTypeCode: '2',
      internalTaxCategory: 'VAT_STANDARD',
    });

    expect(result.classificationCode).toBe('99999999');
    expect(result.unitCode).toBe('NO');
    expect(result.packagingUnitCode).toBe('NT');
    expect(result.productTypeCode).toBe('2');
    expect(result.method).toBe('EXPLICIT');
    expect(result.source).toBe('merchant_override');
  });

  it('UNRESOLVED: classificationCode/unitCode/packagingUnitCode/productTypeCode all resolve to null (never throw) when omitted', async () => {
    await approveTax('B');
    const result = await resolver.resolveClassification({
      merchantId: 'm1',
      internalTaxCategory: 'VAT_STANDARD',
    });

    expect(result.classificationCode).toBeNull();
    expect(result.unitCode).toBeNull();
    expect(result.packagingUnitCode).toBeNull();
    expect(result.productTypeCode).toBeNull();
    expect(result.method).toBe('UNRESOLVED');
    expect(result.source).toBe('rule_based');
  });

  it('resolves taxTyCd from a tenant tax_mappings row when internalTaxCategory is given without an explicit taxTyCd', async () => {
    await approveTax('E', 'VAT_8');
    const result = await resolver.resolveClassification({
      merchantId: 'm1',
      internalTaxCategory: 'VAT_8',
    });
    expect(result.taxTyCd).toBe('E');
  });

  it('falls back to a global (merchantId null) tax_mappings row when no tenant-specific one is active', async () => {
    await taxRepo.save(
      taxRepo.create({
        id: 'taxmap-global-other',
        merchantId: null,
        internalTaxCategory: 'OTHER',
        taxTyCd: 'D',
        version: 1,
        active: true,
        sourceSystem: null,
        status: MappingStatus.MAPPED,
        confidenceScore: null,
        externalValue: null,
        externalId: null,
      }),
    );
    const result = await resolver.resolveClassification({
      merchantId: 'm1',
      internalTaxCategory: 'OTHER',
    });
    expect(result.taxTyCd).toBe('D');
  });

  it('throws when internalTaxCategory has no active tenant or global tax_mappings row', async () => {
    await expect(
      resolver.resolveClassification({
        merchantId: 'm1',
        internalTaxCategory: 'VAT_ZERO',
      }),
    ).rejects.toThrow(/Missing tax mapping/);
  });

  it('throws when internalTaxCategory is missing entirely and no explicit taxTyCd was given', async () => {
    await expect(
      resolver.resolveClassification({ merchantId: 'm1' }),
    ).rejects.toThrow(/Missing internalTaxCategory/);
  });

  it('an explicit taxTyCd skips the tax_mappings lookup entirely', async () => {
    const result = await resolver.resolveClassification({
      merchantId: 'm1',
      taxTyCd: 'A',
    });
    expect(result.taxTyCd).toBe('A');
  });
});
