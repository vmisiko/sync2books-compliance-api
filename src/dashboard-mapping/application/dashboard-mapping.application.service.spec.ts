import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DashboardMappingApplicationService } from './dashboard-mapping.application.service';
import { MappingSuggestionService } from '../../regulatory/oscu/application/mapping-suggestion.service';
import { TaxMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';
import { UnitMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/unit-mapping.orm-entity';
import { ClassificationMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';
import { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';
import { MappingStatus } from '../../shared/domain/enums/mapping-status.enum';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';
import type { MainApiConnection } from '../../integration/main-api-pull/domain/entities/main-api-connection.entity';
import type {
  MainApiTaxRateListResponse,
  MainApiTaxCodeListResponse,
} from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';

const TENANT_ID = 'tenant-1';
const MERCHANT_ID = 'merchant-1';

/** Fakes only the two external collaborators pullTaxRates() reaches through — everything mapping-related uses the real repos below. */
function fakeOrg(): Pick<
  ComplianceOrganizationApplicationService,
  'getTenantById'
> {
  return {
    getTenantById: () =>
      Promise.resolve({
        id: TENANT_ID,
        sync2booksCompanyId: MERCHANT_ID,
      } as Awaited<
        ReturnType<ComplianceOrganizationApplicationService['getTenantById']>
      >),
  };
}

function fakeConnections(
  quickbooksConnectionId: string | null,
): Pick<MainApiConnectionApplicationService, 'ensureCompany'> {
  return {
    ensureCompany: () =>
      Promise.resolve({
        id: 'conn-1',
        complianceTenantId: TENANT_ID,
        mainApiApplicationId: 'app-1',
        mainApiApiKey: 'key-1',
        mainApiCompanyId: 'company-1',
        integrations: quickbooksConnectionId
          ? {
              quickbooks: {
                connectionId: quickbooksConnectionId,
                status: 'connected',
                reason: null,
                updatedAt: new Date(),
              },
            }
          : {},
        webhookEndpointId: null,
        webhookSecret: null,
        lastWebhookEventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as MainApiConnection),
  };
}

function fakeMainApiPull(
  taxRates: MainApiTaxRateListResponse['taxRates'],
  taxCodes: MainApiTaxCodeListResponse['taxCodes'] = [],
): Pick<MainApiPullClient, 'getTaxRates' | 'getTaxCodes'> {
  return {
    getTaxRates: () =>
      Promise.resolve({
        taxRates,
        total: taxRates.length,
        limit: 100,
        offset: 0,
        hasMore: false,
      }),
    getTaxCodes: () =>
      Promise.resolve({
        taxCodes,
        total: taxCodes.length,
        limit: 100,
        offset: 0,
        hasMore: false,
      }),
  };
}

describe('DashboardMappingApplicationService', () => {
  let module: TestingModule;
  let taxRepo: Repository<TaxMappingOrmEntity>;
  let unitRepo: Repository<UnitMappingOrmEntity>;
  let clsRepo: Repository<ClassificationMappingOrmEntity>;

  async function buildService(
    org: Pick<ComplianceOrganizationApplicationService, 'getTenantById'>,
    connections: Pick<MainApiConnectionApplicationService, 'ensureCompany'>,
    mainApiPull: Pick<MainApiPullClient, 'getTaxRates' | 'getTaxCodes'>,
  ): Promise<DashboardMappingApplicationService> {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          autoLoadEntities: true,
          synchronize: true,
          logging: false,
        }),
        TypeOrmModule.forFeature([
          TaxMappingOrmEntity,
          UnitMappingOrmEntity,
          ClassificationMappingOrmEntity,
        ]),
      ],
      providers: [
        DashboardMappingApplicationService,
        MappingSuggestionService,
        { provide: MainApiPullClient, useValue: mainApiPull },
        { provide: MainApiConnectionApplicationService, useValue: connections },
        { provide: ComplianceOrganizationApplicationService, useValue: org },
      ],
    }).compile();

    await module.init();

    taxRepo = module.get(getRepositoryToken(TaxMappingOrmEntity));
    unitRepo = module.get(getRepositoryToken(UnitMappingOrmEntity));
    clsRepo = module.get(getRepositoryToken(ClassificationMappingOrmEntity));

    return module.get(DashboardMappingApplicationService);
  }

  afterEach(async () => {
    if (module) await module.close();
  });

  describe('pullTaxRates', () => {
    it('throws when the tenant has no connected QuickBooks connection', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );
      await expect(service.pullTaxRates(TENANT_ID)).rejects.toThrow(
        /No connected QuickBooks connection/,
      );
    });

    it('creates a NEEDS_REVIEW row for a recognized rate and reports an unrecognized one as unmapped', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull([
          {
            id: 'rate-1',
            name: '16%',
            displayName: '16% Standard VAT',
            status: 'Active',
            effectiveTaxRate: 16,
            totalTaxRate: 16,
            connectionId: 'qb-conn-1',
          },
          {
            id: 'rate-2',
            name: 'Custom Weird Rate',
            status: 'Active',
            effectiveTaxRate: 7.5,
            totalTaxRate: 7.5,
            connectionId: 'qb-conn-1',
          },
        ]),
      );

      const result = await service.pullTaxRates(TENANT_ID);

      expect(result.attempted).toBe(2);
      expect(result.suggested).toBe(1);
      expect(result.unmapped).toBe(1);

      const mapped = result.results.find((r) => r.externalId === 'rate-1');
      expect(mapped?.status).toBe(MappingStatus.NEEDS_REVIEW);
      expect(mapped?.mappingId).toBeTruthy();

      const unmapped = result.results.find((r) => r.externalId === 'rate-2');
      expect(unmapped?.status).toBe(MappingStatus.UNMAPPED);
      expect(unmapped?.mappingId).toBeNull();

      const row = await taxRepo.findOne({ where: { id: mapped!.mappingId! } });
      expect(row?.sourceSystem).toBe(SourceSystem.QUICKBOOKS);
      expect(row?.status).toBe(MappingStatus.NEEDS_REVIEW);
      expect(row?.active).toBe(false);
      expect(row?.confidenceScore).toBeGreaterThanOrEqual(90);
    });

    it('does not overwrite an already-approved mapping for the same category on re-pull', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull([
          {
            id: 'rate-1',
            name: '16% Standard VAT',
            status: 'Active',
            effectiveTaxRate: 16,
            totalTaxRate: 16,
            connectionId: 'qb-conn-1',
          },
        ]),
      );

      const first = await service.pullTaxRates(TENANT_ID);
      const mappingId = first.results[0].mappingId!;
      await service.approve(TENANT_ID, mappingId, 'reviewer@example.com');

      const second = await service.pullTaxRates(TENANT_ID);
      expect(second.results[0].mappingId).toBe(mappingId);
      expect(second.results[0].status).toBe(MappingStatus.MAPPED);
    });
  });

  describe('pullTaxRates -> tax codes (taxCodeId resolution)', () => {
    it('resolves taxCodeId onto the tax-rate-created row for the same category', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull(
          [
            {
              id: 'rate-1',
              name: '16% Standard VAT',
              status: 'Active',
              effectiveTaxRate: 16,
              totalTaxRate: 16,
              connectionId: 'qb-conn-1',
            },
          ],
          [
            {
              id: 'code-1',
              name: '16.0% S',
              active: true,
              taxable: true,
              taxGroup: false,
              connectionId: 'qb-conn-1',
              salesTaxRateRefs: [{ id: '13', name: 'SS-16' }],
              purchaseTaxRateRefs: [],
            },
          ],
        ),
      );

      const result = await service.pullTaxRates(TENANT_ID);

      expect(result.taxCodes.attempted).toBe(1);
      expect(result.taxCodes.resolved).toBe(1);
      const taxCodeResult = result.taxCodes.results[0];
      expect(taxCodeResult.taxCodeId).toBe('code-1');
      expect(taxCodeResult.internalTaxCategory).toBe(TaxCategory.VAT_STANDARD);

      // Same row as the one the TaxRate suggestion created.
      const rateMappingId = result.results[0].mappingId!;
      expect(taxCodeResult.mappingId).toBe(rateMappingId);

      const row = await taxRepo.findOne({ where: { id: rateMappingId } });
      expect(row?.taxCodeId).toBe('code-1');
      expect(row?.taxCodeExternalValue).toBe('16.0% S');
      expect(row?.taxCodeConfidenceScore).toBeGreaterThanOrEqual(90);
      // TaxRate-derived fields are untouched, still describing the rate.
      expect(row?.internalTaxCategory).toBe(TaxCategory.VAT_STANDARD);
      expect(row?.externalValue).toBe('16% Standard VAT');
    });

    it('prefers the higher-confidence TaxCode when several map to the same category, regardless of pull order', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull(
          [],
          [
            // Lower-confidence Import variant pulled first...
            {
              id: 'code-import',
              name: '16.0% S Import',
              active: true,
              taxable: true,
              taxGroup: false,
              connectionId: 'qb-conn-1',
              salesTaxRateRefs: [],
              purchaseTaxRateRefs: [{ id: '20', name: 'Import VAT' }],
            },
            // ...then the plain, higher-confidence standard code.
            {
              id: 'code-plain',
              name: '16.0% S',
              active: true,
              taxable: true,
              taxGroup: false,
              connectionId: 'qb-conn-1',
              salesTaxRateRefs: [{ id: '13', name: 'SS-16' }],
              purchaseTaxRateRefs: [],
            },
          ],
        ),
      );

      const result = await service.pullTaxRates(TENANT_ID);
      const mappingId = result.taxCodes.results.find(
        (r) => r.externalId === 'code-plain',
      )!.mappingId!;

      const row = await taxRepo.findOne({ where: { id: mappingId } });
      expect(row?.taxCodeId).toBe('code-plain');
      expect(row?.taxCodeExternalValue).toBe('16.0% S');
    });

    it('creates a new NEEDS_REVIEW row from TaxCode data alone when no TaxRate row exists for that category', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull(
          [],
          [
            {
              id: 'code-exempt',
              name: 'Exempt Sale',
              active: true,
              taxable: false,
              taxGroup: false,
              connectionId: 'qb-conn-1',
              salesTaxRateRefs: [],
              purchaseTaxRateRefs: [],
            },
          ],
        ),
      );

      const result = await service.pullTaxRates(TENANT_ID);
      const taxCodeResult = result.taxCodes.results[0];
      expect(taxCodeResult.internalTaxCategory).toBe(TaxCategory.EXEMPT);
      expect(taxCodeResult.taxCodeId).toBe('code-exempt');

      const row = await taxRepo.findOne({
        where: { id: taxCodeResult.mappingId! },
      });
      expect(row?.taxTyCd).toBe('A');
      expect(row?.status).toBe(MappingStatus.NEEDS_REVIEW);
      expect(row?.active).toBe(false);
      expect(row?.sourceSystem).toBe(SourceSystem.QUICKBOOKS);
    });

    it('reports an unrecognized TaxCode name as unmapped without persisting a row', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull(
          [],
          [
            {
              id: 'code-weird',
              name: 'Custom Weird Code',
              active: true,
              taxable: true,
              taxGroup: false,
              connectionId: 'qb-conn-1',
              salesTaxRateRefs: [],
              purchaseTaxRateRefs: [],
            },
          ],
        ),
      );

      const result = await service.pullTaxRates(TENANT_ID);
      expect(result.taxCodes.unmapped).toBe(1);
      expect(result.taxCodes.results[0].mappingId).toBeNull();
      expect(result.taxCodes.results[0].taxCodeId).toBeNull();
    });

    it('does not overwrite taxCodeId on an already-resolved row with a lower-confidence match on re-pull', async () => {
      // A mutable getTaxCodes so the *same* service/DB can be re-pulled with
      // a different TaxCode response, unlike fakeMainApiPull's fixed closure.
      let taxCodes: MainApiTaxCodeListResponse['taxCodes'] = [
        {
          id: 'code-plain',
          name: '16.0% S',
          active: true,
          taxable: true,
          taxGroup: false,
          connectionId: 'qb-conn-1',
          salesTaxRateRefs: [{ id: '13', name: 'SS-16' }],
          purchaseTaxRateRefs: [],
        },
      ];
      const mainApiPull: Pick<
        MainApiPullClient,
        'getTaxRates' | 'getTaxCodes'
      > = {
        getTaxRates: () =>
          Promise.resolve({
            taxRates: [
              {
                id: 'rate-1',
                name: '16% Standard VAT',
                status: 'Active',
                effectiveTaxRate: 16,
                totalTaxRate: 16,
                connectionId: 'qb-conn-1',
              },
            ],
            total: 1,
            limit: 100,
            offset: 0,
            hasMore: false,
          }),
        getTaxCodes: () =>
          Promise.resolve({
            taxCodes,
            total: taxCodes.length,
            limit: 100,
            offset: 0,
            hasMore: false,
          }),
      };

      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        mainApiPull,
      );

      const first = await service.pullTaxRates(TENANT_ID);
      const mappingId = first.results[0].mappingId!;
      const afterFirstPull = await taxRepo.findOne({
        where: { id: mappingId },
      });
      expect(afterFirstPull?.taxCodeId).toBe('code-plain');

      // Re-pull where this time only a lower-confidence Import variant comes back.
      taxCodes = [
        {
          id: 'code-import',
          name: '16.0% S Import',
          active: true,
          taxable: true,
          taxGroup: false,
          connectionId: 'qb-conn-1',
          salesTaxRateRefs: [],
          purchaseTaxRateRefs: [{ id: '20', name: 'Import VAT' }],
        },
      ];
      await service.pullTaxRates(TENANT_ID);

      const afterSecondPull = await taxRepo.findOne({
        where: { id: mappingId },
      });
      expect(afterSecondPull?.taxCodeId).toBe('code-plain');
      expect(afterSecondPull?.taxCodeExternalValue).toBe('16.0% S');
    });
  });

  describe('list / summary', () => {
    it('lists tenant rows plus global defaults, and filters by source/status/type', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );

      await taxRepo.save(
        taxRepo.create({
          id: 'taxmap-global-1',
          merchantId: null,
          internalTaxCategory: TaxCategory.OTHER,
          taxTyCd: 'D',
          version: 1,
          active: true,
          status: MappingStatus.MAPPED,
          sourceSystem: null,
          confidenceScore: null,
          approvedBy: null,
          approvedAt: null,
          externalValue: null,
        }),
      );
      await taxRepo.save(
        taxRepo.create({
          id: 'taxmap-tenant-1',
          merchantId: MERCHANT_ID,
          internalTaxCategory: TaxCategory.VAT_STANDARD,
          taxTyCd: 'B',
          version: 1,
          active: false,
          status: MappingStatus.NEEDS_REVIEW,
          sourceSystem: SourceSystem.QUICKBOOKS,
          confidenceScore: 94,
          approvedBy: null,
          approvedAt: null,
          externalValue: '16%',
        }),
      );

      const all = await service.list(TENANT_ID, {});
      expect(all.map((r) => r.id).sort()).toEqual(
        ['taxmap-global-1', 'taxmap-tenant-1'].sort(),
      );

      const bySource = await service.list(TENANT_ID, { source: 'quickbooks' });
      expect(bySource.map((r) => r.id)).toEqual(['taxmap-tenant-1']);

      const byStatus = await service.list(TENANT_ID, {
        status: 'needs_review',
      });
      expect(byStatus.map((r) => r.id)).toEqual(['taxmap-tenant-1']);

      const byType = await service.list(TENANT_ID, { type: 'unit' });
      expect(byType).toEqual([]);

      await expect(
        service.list(TENANT_ID, { source: 'not-a-real-source' }),
      ).rejects.toThrow(/Unknown source filter/);
    });

    it('summarizes global vs per-source mapped/total counts', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );

      await taxRepo.save(
        taxRepo.create({
          id: 'taxmap-global-1',
          merchantId: null,
          internalTaxCategory: TaxCategory.OTHER,
          taxTyCd: 'D',
          version: 1,
          active: true,
          status: MappingStatus.MAPPED,
          sourceSystem: null,
        }),
      );
      await taxRepo.save(
        taxRepo.create({
          id: 'taxmap-tenant-mapped',
          merchantId: MERCHANT_ID,
          internalTaxCategory: TaxCategory.VAT_STANDARD,
          taxTyCd: 'B',
          version: 1,
          active: true,
          status: MappingStatus.MAPPED,
          sourceSystem: SourceSystem.QUICKBOOKS,
        }),
      );
      await taxRepo.save(
        taxRepo.create({
          id: 'taxmap-tenant-pending',
          merchantId: MERCHANT_ID,
          internalTaxCategory: TaxCategory.VAT_ZERO,
          taxTyCd: 'C',
          version: 1,
          active: false,
          status: MappingStatus.NEEDS_REVIEW,
          sourceSystem: SourceSystem.QUICKBOOKS,
        }),
      );

      const summary = await service.summary(TENANT_ID);
      expect(summary.global).toEqual({ mapped: 1, total: 1 });
      expect(summary.overall).toEqual({ mapped: 2, total: 3 });
      expect(summary.bySource).toEqual([
        { sourceSystem: SourceSystem.QUICKBOOKS, mapped: 1, total: 2 },
      ]);
    });
  });

  describe('approve / update / createManual', () => {
    it('approves a NEEDS_REVIEW row, stamping approvedBy from the session and activating it', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull([
          {
            id: 'rate-1',
            name: '16% Standard VAT',
            status: 'Active',
            effectiveTaxRate: 16,
            totalTaxRate: 16,
            connectionId: 'qb-conn-1',
          },
        ]),
      );

      const pulled = await service.pullTaxRates(TENANT_ID);
      const mappingId = pulled.results[0].mappingId!;

      const approved = await service.approve(
        TENANT_ID,
        mappingId,
        'reviewer@example.com',
      );
      expect(approved.status).toBe(MappingStatus.MAPPED);
      expect(approved.approvedBy).toBe('reviewer@example.com');
      expect(approved.active).toBe(true);
    });

    it('rejects approving a mapping that belongs to a different tenant', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );
      const other = await taxRepo.save(
        taxRepo.create({
          id: 'taxmap-other-tenant',
          merchantId: 'some-other-merchant',
          internalTaxCategory: TaxCategory.VAT_STANDARD,
          taxTyCd: 'B',
          version: 1,
          active: false,
          status: MappingStatus.NEEDS_REVIEW,
          sourceSystem: SourceSystem.QUICKBOOKS,
        }),
      );
      await expect(
        service.approve(TENANT_ID, other.id, 'reviewer@example.com'),
      ).rejects.toThrow(/not found/);
    });

    it('marks a re-edited MAPPED row as REVISED and keeps approvedBy from the session, not any client-supplied value', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );
      const created = await service.createManual(
        TENANT_ID,
        {
          type: 'tax',
          internalTaxCategory: TaxCategory.VAT_STANDARD,
          taxTyCd: 'B',
        },
        'creator@example.com',
      );
      expect(created.status).toBe(MappingStatus.MAPPED);
      expect(created.approvedBy).toBe('creator@example.com');
      expect(created.sourceSystem).toBe(SourceSystem.MANUAL);

      const revised = await service.update(
        TENANT_ID,
        created.id,
        { taxTyCd: 'D' },
        'editor@example.com',
      );
      expect(revised.status).toBe(MappingStatus.REVISED);
      expect(revised.approvedBy).toBe('editor@example.com');
      expect(revised.taxTyCd).toBe('D');
    });

    it('createManual persists a unit mapping and a classification mapping to their own tables, already MAPPED/active', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );

      const unit = await service.createManual(
        TENANT_ID,
        { type: 'unit', internalUnit: 'EA', qtyUnitCd: 'NO', pkgUnitCd: 'NT' },
        'creator@example.com',
      );
      const unitRow = await unitRepo.findOne({ where: { id: unit.id } });
      expect(unitRow?.merchantId).toBe(MERCHANT_ID);
      expect(unitRow?.sourceSystem).toBe(SourceSystem.MANUAL);
      expect(unitRow?.status).toBe(MappingStatus.MAPPED);
      expect(unitRow?.active).toBe(true);
      expect(unitRow?.approvedBy).toBe('creator@example.com');

      const cls = await service.createManual(
        TENANT_ID,
        {
          type: 'classification',
          matchType: 'SKU',
          matchValue: 'SKU-1',
          itemClsCd: '14111400',
        },
        'creator@example.com',
      );
      const clsRow = await clsRepo.findOne({ where: { id: cls.id } });
      expect(clsRow?.merchantId).toBe(MERCHANT_ID);
      expect(clsRow?.sourceSystem).toBe(SourceSystem.MANUAL);
      expect(clsRow?.status).toBe(MappingStatus.MAPPED);
      expect(clsRow?.active).toBe(true);
      expect(clsRow?.approvedBy).toBe('creator@example.com');
    });

    it('createManual requires the target codes for each mapping type', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );
      await expect(
        service.createManual(TENANT_ID, { type: 'tax' }, 'creator@example.com'),
      ).rejects.toThrow(/required/);
      await expect(
        service.createManual(
          TENANT_ID,
          { type: 'unit' },
          'creator@example.com',
        ),
      ).rejects.toThrow(/required/);
      await expect(
        service.createManual(
          TENANT_ID,
          { type: 'classification' },
          'creator@example.com',
        ),
      ).rejects.toThrow(/required/);
    });

    it('activateTaxRow deactivates a previously-active row for the same (merchantId, internalTaxCategory)', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );
      const first = await service.createManual(
        TENANT_ID,
        {
          type: 'tax',
          internalTaxCategory: TaxCategory.VAT_STANDARD,
          taxTyCd: 'B',
        },
        'creator@example.com',
      );
      const second = await service.createManual(
        TENANT_ID,
        {
          type: 'tax',
          internalTaxCategory: TaxCategory.VAT_STANDARD,
          taxTyCd: 'B2',
        },
        'creator@example.com',
      );

      const firstRow = await taxRepo.findOne({ where: { id: first.id } });
      const secondRow = await taxRepo.findOne({ where: { id: second.id } });
      expect(firstRow?.active).toBe(false);
      expect(secondRow?.active).toBe(true);
    });
  });
});
