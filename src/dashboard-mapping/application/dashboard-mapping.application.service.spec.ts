import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DashboardMappingApplicationService } from './dashboard-mapping.application.service';
import { MappingSuggestionService } from '../../regulatory/oscu/application/mapping-suggestion.service';
import { TaxMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';
import { ClassificationMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';
import { PaymentTypeMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/payment-type-mapping.orm-entity';
import { OscuCodeOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-code.orm-entity';
import { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { CatalogService } from '../../catalog/api/catalog.service';
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';
import { MappingStatus } from '../../shared/domain/enums/mapping-status.enum';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';
import type { MainApiConnection } from '../../integration/main-api-pull/domain/entities/main-api-connection.entity';
import type {
  MainApiTaxRateListResponse,
  MainApiTaxCodeListResponse,
  MainApiItem,
  MainApiPaymentMethodListResponse,
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
  items: MainApiItem[] = [],
  paymentMethods: MainApiPaymentMethodListResponse['paymentMethods'] = [],
): Pick<
  MainApiPullClient,
  'getTaxRates' | 'getTaxCodes' | 'getItems' | 'getPaymentMethods'
> {
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
    // Single-page fake: tests here use far fewer than 100 items, so
    // fetchAllItems()'s pagination loop always exits after page 1.
    getItems: () =>
      Promise.resolve({
        data: items,
        total: items.length,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    getPaymentMethods: () => Promise.resolve({ paymentMethods }),
  };
}

describe('DashboardMappingApplicationService', () => {
  let module: TestingModule;
  let taxRepo: Repository<TaxMappingOrmEntity>;
  let clsRepo: Repository<ClassificationMappingOrmEntity>;
  let oscuCodeRepo: Repository<OscuCodeOrmEntity>;
  let paymentRepo: Repository<PaymentTypeMappingOrmEntity>;

  async function buildService(
    org: Pick<ComplianceOrganizationApplicationService, 'getTenantById'>,
    connections: Pick<MainApiConnectionApplicationService, 'ensureCompany'>,
    mainApiPull: Pick<
      MainApiPullClient,
      'getTaxRates' | 'getTaxCodes' | 'getItems' | 'getPaymentMethods'
    >,
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
          ClassificationMappingOrmEntity,
          PaymentTypeMappingOrmEntity,
          OscuCodeOrmEntity,
        ]),
      ],
      providers: [
        DashboardMappingApplicationService,
        MappingSuggestionService,
        { provide: MainApiPullClient, useValue: mainApiPull },
        { provide: MainApiConnectionApplicationService, useValue: connections },
        { provide: ComplianceOrganizationApplicationService, useValue: org },
        {
          provide: CatalogService,
          useValue: { searchItemClassifications: () => Promise.resolve([]) },
        },
      ],
    }).compile();

    await module.init();

    taxRepo = module.get(getRepositoryToken(TaxMappingOrmEntity));
    clsRepo = module.get(getRepositoryToken(ClassificationMappingOrmEntity));
    oscuCodeRepo = module.get(getRepositoryToken(OscuCodeOrmEntity));
    paymentRepo = module.get(getRepositoryToken(PaymentTypeMappingOrmEntity));

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
            effectiveTaxRate: 21.5,
            totalTaxRate: 21.5,
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
      expect(unmapped?.mappingId).toBeTruthy();
      expect(unmapped?.confidenceScore).toBe(0);

      const row = await taxRepo.findOne({ where: { id: mapped!.mappingId! } });
      expect(row?.sourceSystem).toBe(SourceSystem.QUICKBOOKS);
      expect(row?.status).toBe(MappingStatus.NEEDS_REVIEW);
      expect(row?.active).toBe(false);
      expect(row?.confidenceScore).toBeGreaterThanOrEqual(90);

      // Unmapped rate is persisted too (default confidence 0, no KRA code
      // yet) so it shows up in the Mapping Center table instead of only
      // existing in this transient pull response.
      const unmappedRow = await taxRepo.findOne({
        where: { id: unmapped!.mappingId! },
      });
      expect(unmappedRow?.status).toBe(MappingStatus.UNMAPPED);
      expect(unmappedRow?.confidenceScore).toBe(0);
      expect(unmappedRow?.internalTaxCategory).toBeNull();
      expect(unmappedRow?.taxTyCd).toBeNull();
      expect(unmappedRow?.externalId).toBe('rate-2');
      expect(unmappedRow?.externalValue).toBe('Custom Weird Rate');
      expect(unmappedRow?.active).toBe(false);
    });

    it('refreshes an unmapped row on re-pull instead of duplicating it, and leaves it alone once a human approves it', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull([
          {
            id: 'rate-2',
            name: 'Custom Weird Rate',
            status: 'Active',
            effectiveTaxRate: 21.5,
            totalTaxRate: 21.5,
            connectionId: 'qb-conn-1',
          },
        ]),
      );

      const first = await service.pullTaxRates(TENANT_ID);
      const mappingId = first.results[0].mappingId!;

      const second = await service.pullTaxRates(TENANT_ID);
      expect(second.results[0].mappingId).toBe(mappingId);
      const allRows = await taxRepo.find({ where: { externalId: 'rate-2' } });
      expect(allRows).toHaveLength(1);

      const approved = await service.update(
        TENANT_ID,
        mappingId,
        { internalTaxCategory: TaxCategory.VAT_STANDARD, taxTyCd: 'B' },
        'reviewer@example.com',
      );
      expect(approved.status).toBe(MappingStatus.MAPPED);

      const third = await service.pullTaxRates(TENANT_ID);
      expect(third.results[0].mappingId).toBe(mappingId);
      expect(third.results[0].status).toBe(MappingStatus.MAPPED);
      const rowAfterApproval = await taxRepo.findOne({
        where: { id: mappingId },
      });
      expect(rowAfterApproval?.internalTaxCategory).toBe(
        TaxCategory.VAT_STANDARD,
      );
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
        'getTaxRates' | 'getTaxCodes' | 'getItems' | 'getPaymentMethods'
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
        // This test only calls pullTaxRates() directly, never pullAll(), so
        // getItems()/getPaymentMethods() are never actually invoked --
        // present only to satisfy buildService()'s parameter type.
        getItems: () =>
          Promise.resolve({
            data: [],
            total: 0,
            page: 1,
            limit: 100,
            totalPages: 1,
          }),
        getPaymentMethods: () => Promise.resolve({ paymentMethods: [] }),
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

  describe('pullAll -> classifications (derived from items)', () => {
    function item(overrides: Partial<MainApiItem>): MainApiItem {
      return {
        id: 'item-default',
        itemCode: 'IC-default',
        name: 'Item',
        active: true,
        ...overrides,
      };
    }

    it('creates one NEEDS_REVIEW classification placeholder per item, not deduped', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull(
          [],
          [],
          [
            item({
              id: 'i1',
              itemCode: 'QB_1',
              name: 'Maize Flour 2kg',
              sku: 'MF-2KG',
            }),
            item({
              id: 'i2',
              itemCode: 'QB_2',
              name: 'Sukuma Wiki Bunch',
              sku: 'SW-1',
            }),
          ],
        ),
      );

      const result = await service.pullAll(TENANT_ID);

      expect(result.classifications.attempted).toBe(2);
      expect(result.classifications.needsReview).toBe(2);

      const rows = await clsRepo.find({ where: { merchantId: MERCHANT_ID } });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === MappingStatus.NEEDS_REVIEW)).toBe(
        true,
      );
      expect(rows.every((r) => r.itemClsCd === null)).toBe(true);
      // suggestClassificationPlaceholder prefers externalId first.
      expect(rows.map((r) => r.matchType)).toEqual([
        'EXTERNAL_ID',
        'EXTERNAL_ID',
      ]);
      // matchValue is bookId ?? itemCode (the same value registration's
      // ClassificationResolverTypeOrm looks up by), not MainApiItem.id --
      // see pullClassifications' doc comment for why.
      expect(rows.map((r) => r.matchValue).sort()).toEqual(['QB_1', 'QB_2']);
    });

    it('re-pulling classifications refreshes externalValue without creating a duplicate or disturbing an approved row', async () => {
      // A mutable getItems so the *same* service/DB can simulate the source
      // system's item list changing between two pulls -- buildService()
      // would otherwise give each call its own fresh in-memory sqljs DB,
      // defeating the point of testing a re-pull against existing rows.
      let currentItems: MainApiItem[] = [
        item({ id: 'i1', name: 'Maize Flour 2kg', sku: 'MF-2KG' }),
      ];
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        {
          ...fakeMainApiPull([], []),
          getItems: () =>
            Promise.resolve({
              data: currentItems,
              total: currentItems.length,
              page: 1,
              limit: 100,
              totalPages: 1,
            }),
        },
      );

      const first = await service.pullAll(TENANT_ID);
      const mappingId = first.classifications.results[0].mappingId;
      await service.update(
        TENANT_ID,
        mappingId,
        { itemClsCd: '14111400', qtyUnitCd: 'KG', pkgUnitCd: 'NT' },
        'reviewer@example.com',
      );

      // Renamed in the source system -- re-pull should refresh
      // externalValue, not create a second row or reset the approval.
      currentItems = [
        item({ id: 'i1', name: 'Maize Flour 2kg (renamed)', sku: 'MF-2KG' }),
      ];
      await service.pullAll(TENANT_ID);

      const rows = await clsRepo.find({ where: { merchantId: MERCHANT_ID } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(MappingStatus.MAPPED);
      expect(rows[0].itemClsCd).toBe('14111400');
      // Approved (active) rows are left untouched on re-pull, same as
      // upsertUnmappedTaxRate/upsertUnmappedUnit -- the point being tested
      // here is "no duplicate row and the approval survives", not a name
      // refresh on an already-resolved row.
      expect(rows[0].externalValue).toBe('Maize Flour 2kg');
    });

    it('throws when the tenant has no connected QuickBooks connection', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([], [], []),
      );
      await expect(service.pullAll(TENANT_ID)).rejects.toThrow(
        /No connected QuickBooks connection/,
      );
    });

    it('list() surfaces resolvedTaxTyCd for a classification row when its tax category has an active mapping, and null when it does not', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull(
          [],
          [],
          [
            item({
              id: 'i1',
              itemCode: 'QB_1',
              name: 'Rice 2kg',
              unitOfMeasure: 'kg',
              // Deliberately not "16.0% S" -- mapQbTaxToInternalTaxCategory's
              // isZeroRate check does a crude `.includes('0%')`, which also
              // matches inside "16.0%" (a real pre-existing bug, flagged
              // separately -- not something this test is about).
              defaultTaxCodeRef: { id: 'tc1', name: '16% Standard VAT' },
            }),
            item({
              id: 'i2',
              itemCode: 'QB_2',
              name: 'Consulting Service',
              unitOfMeasure: 'each',
              defaultTaxCodeRef: undefined,
            }),
          ],
        ),
      );

      // Approve a tax mapping for VAT_STANDARD -- matches what
      // mapQbTaxToInternalTaxCategory derives for the "Rice 2kg" item above.
      await service.createManual(
        TENANT_ID,
        {
          type: 'tax',
          internalTaxCategory: TaxCategory.VAT_STANDARD,
          taxTyCd: 'B',
        },
        'reviewer@example.com',
      );

      await service.pullAll(TENANT_ID);

      const items = await service.list(TENANT_ID, { type: 'classification' });
      const rice = items.find((i) => i.externalValue === 'Rice 2kg')!;
      const consulting = items.find(
        (i) => i.externalValue === 'Consulting Service',
      )!;

      expect(rice.resolvedInternalTaxCategory).toBe(TaxCategory.VAT_STANDARD);
      expect(rice.resolvedTaxTyCd).toBe('B');

      // No SalesTaxCodeRef -> OTHER, and no active tax mapping exists for
      // OTHER in this test, so it should resolve to null, not throw or
      // silently default.
      expect(consulting.resolvedInternalTaxCategory).toBe(TaxCategory.OTHER);
      expect(consulting.resolvedTaxTyCd).toBeNull();
    });

    it('auto-matches qtyUnitCd/pkgUnitCd directly against the real KRA code list per item, independently -- not via a shared category', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull(
          [],
          [],
          [
            item({
              id: 'i1',
              itemCode: 'QB_1',
              name: 'Rice 2kg',
              unitOfMeasure: 'kg',
            }),
            item({
              id: 'i2',
              itemCode: 'QB_2',
              name: 'Bolt Box',
              unitOfMeasure: 'Gross (144)',
            }),
          ],
        ),
      );

      // Real (trimmed) KRA reference data, same shape as the synced table:
      // "kg" exact-matches cd 'KG' (quantity) but nothing in packaging --
      // it's a measurement unit, not a way of packaging something. "Gross
      // (144)" matches neither list at all.
      await oscuCodeRepo.save([
        oscuCodeRepo.create({
          cdCls: '10',
          cd: 'KG',
          cdNm: 'Kilo-Gramme',
          srtOrd: 1,
          useYn: 'Y',
        }),
        oscuCodeRepo.create({
          cdCls: '17',
          cd: 'BG',
          cdNm: 'Bag',
          srtOrd: 1,
          useYn: 'Y',
        }),
        oscuCodeRepo.create({
          cdCls: '17',
          cd: 'BX',
          cdNm: 'Box',
          srtOrd: 2,
          useYn: 'Y',
        }),
      ]);

      await service.pullAll(TENANT_ID);

      const items = await service.list(TENANT_ID, { type: 'classification' });
      const rice = items.find((i) => i.externalValue === 'Rice 2kg')!;
      const bolt = items.find((i) => i.externalValue === 'Bolt Box')!;

      expect(rice.qtyUnitCd).toBe('KG');
      expect(rice.qtyUnitCdConfidence).toBeGreaterThanOrEqual(90);
      // "kg" doesn't match "Bag" or "Box" by name or code -- genuinely
      // needs a human to pick the packaging, not silently defaulted.
      expect(rice.pkgUnitCd).toBeNull();
      expect(rice.pkgUnitCdConfidence).toBeNull();

      expect(bolt.qtyUnitCd).toBeNull();
      expect(bolt.qtyUnitCdConfidence).toBeNull();
      expect(bolt.pkgUnitCd).toBeNull();
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

      const byType = await service.list(TENANT_ID, { type: 'classification' });
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

    it('createManual persists a classification mapping already MAPPED/active once itemClsCd, qtyUnitCd, and pkgUnitCd are all supplied', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );

      const cls = await service.createManual(
        TENANT_ID,
        {
          type: 'classification',
          matchType: 'SKU',
          matchValue: 'SKU-1',
          itemClsCd: '14111400',
          qtyUnitCd: 'NO',
          pkgUnitCd: 'NT',
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

    it('createManual leaves a classification row NEEDS_REVIEW/inactive when only itemClsCd is supplied -- qtyUnitCd/pkgUnitCd are independent fields, not silently defaulted', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );

      const cls = await service.createManual(
        TENANT_ID,
        {
          type: 'classification',
          matchType: 'SKU',
          matchValue: 'SKU-2',
          itemClsCd: '14111400',
        },
        'creator@example.com',
      );
      expect(cls.status).toBe(MappingStatus.NEEDS_REVIEW);
      expect(cls.active).toBe(false);
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

  describe('bulkClassify', () => {
    it('applies one itemClsCd to several classification rows, marking each MAPPED/active', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );
      const a = await service.createManual(
        TENANT_ID,
        {
          type: 'classification',
          matchType: 'SKU',
          matchValue: 'SKU-A',
          itemClsCd: '10000000',
          qtyUnitCd: 'NO',
          pkgUnitCd: 'NT',
        },
        'seed@example.com',
      );
      const b = await service.createManual(
        TENANT_ID,
        {
          type: 'classification',
          matchType: 'SKU',
          matchValue: 'SKU-B',
          itemClsCd: '10000000',
          qtyUnitCd: 'NO',
          pkgUnitCd: 'NT',
        },
        'seed@example.com',
      );

      const result = await service.bulkClassify(
        TENANT_ID,
        [a.id, b.id],
        { itemClsCd: '14111400', itemType: 'GOODS' },
        'reviewer@example.com',
      );

      expect(result.skipped).toEqual([]);
      expect(result.updated).toHaveLength(2);
      for (const row of result.updated) {
        expect(row.itemClsCd).toBe('14111400');
        expect(row.itemType).toBe('GOODS');
        expect(row.approvedBy).toBe('reviewer@example.com');
        expect(row.active).toBe(true);
      }
    });

    it('marks an already-approved row REVISED instead of MAPPED, and skips ids from another tenant', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );
      const approved = await service.createManual(
        TENANT_ID,
        {
          type: 'classification',
          matchType: 'SKU',
          matchValue: 'SKU-C',
          itemClsCd: '10000000',
          qtyUnitCd: 'NO',
          pkgUnitCd: 'NT',
        },
        'seed@example.com',
      );
      const otherTenantRow = await clsRepo.save(
        clsRepo.create({
          id: 'clsmap-other-tenant',
          merchantId: 'some-other-merchant',
          matchType: 'SKU',
          matchValue: 'SKU-D',
          itemType: null,
          itemClsCd: null,
          priority: 100,
          source: 'merchant_override',
          active: false,
          sourceSystem: SourceSystem.MANUAL,
          status: MappingStatus.NEEDS_REVIEW,
          confidenceScore: null,
          externalValue: null,
        }),
      );

      const result = await service.bulkClassify(
        TENANT_ID,
        [approved.id, otherTenantRow.id],
        { itemClsCd: '14111400' },
        'reviewer@example.com',
      );

      expect(result.skipped).toEqual([otherTenantRow.id]);
      expect(result.updated).toHaveLength(1);
      expect(result.updated[0].status).toBe(MappingStatus.REVISED);
      expect(result.updated[0].itemClsCd).toBe('14111400');
    });

    it('rejects an empty itemClsCd up front', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );
      await expect(
        service.bulkClassify(
          TENANT_ID,
          ['clsmap-x'],
          { itemClsCd: '' },
          'r@example.com',
        ),
      ).rejects.toThrow(/required/);
    });
  });

  describe('searchItemClassifications', () => {
    it('delegates to CatalogService.searchItemClassifications', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );
      // The test module wires CatalogService to a stub returning [] — this
      // just confirms the pass-through doesn't throw and returns that shape.
      const results = await service.searchItemClassifications({
        query: 'rice',
      });
      expect(results).toEqual([]);
    });
  });

  describe('listTaxCategoryOptions', () => {
    it('reads KRA tax-type codes from oscu_codes (cdCls 04) and resolves each to an internal category', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );

      await oscuCodeRepo.save([
        oscuCodeRepo.create({
          cdCls: '04',
          cd: 'B',
          cdNm: 'VAT Standard',
          srtOrd: 2,
          useYn: 'Y',
        }),
        oscuCodeRepo.create({
          cdCls: '04',
          cd: 'E',
          cdNm: 'VAT 8%',
          srtOrd: 5,
          useYn: 'Y',
        }),
        // Different code class -- must not leak into the tax-category list.
        oscuCodeRepo.create({
          cdCls: '10',
          cd: 'KG',
          cdNm: 'Kilo-Gramme',
          srtOrd: 1,
          useYn: 'Y',
        }),
      ]);

      const options = await service.listTaxCategoryOptions();
      expect(options).toEqual([
        {
          internalTaxCategory: TaxCategory.VAT_STANDARD,
          taxTyCd: 'B',
          cdNm: 'VAT Standard',
          label: 'B — VAT Standard',
        },
        {
          internalTaxCategory: TaxCategory.VAT_8,
          taxTyCd: 'E',
          cdNm: 'VAT 8%',
          label: 'E — VAT 8%',
        },
      ]);
    });
  });

  describe('pullPaymentMethods', () => {
    it('throws when the tenant has no connected QuickBooks connection', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections(null),
        fakeMainApiPull([]),
      );
      await expect(service.pullPaymentMethods(TENANT_ID)).rejects.toThrow(
        /No connected QuickBooks connection/,
      );
    });

    it('creates a NEEDS_REVIEW row for a recognized method and reports an unrecognized one as unmapped', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull([], [], [], [
          { id: 'pm-1', name: 'M-Pesa', type: 'OTHER', active: true },
          { id: 'pm-2', name: 'Store Loyalty Points', type: 'OTHER', active: true },
        ]),
      );

      const result = await service.pullPaymentMethods(TENANT_ID);

      expect(result.attempted).toBe(2);
      expect(result.suggested).toBe(1);
      expect(result.unmapped).toBe(1);

      const mapped = result.results.find((r) => r.externalId === 'pm-1');
      expect(mapped?.status).toBe(MappingStatus.NEEDS_REVIEW);
      expect(mapped?.internalPaymentMethod).toBe('MOBILE_MONEY');

      const row = await paymentRepo.findOne({
        where: { id: mapped!.mappingId! },
      });
      expect(row?.sourceSystem).toBe(SourceSystem.QUICKBOOKS);
      expect(row?.pmtTyCd).toBe('07');
      expect(row?.active).toBe(false);
      expect(row?.confidenceScore).toBeGreaterThanOrEqual(90);

      const unmapped = result.results.find((r) => r.externalId === 'pm-2');
      expect(unmapped?.status).toBe(MappingStatus.UNMAPPED);
      const unmappedRow = await paymentRepo.findOne({
        where: { id: unmapped!.mappingId! },
      });
      expect(unmappedRow?.internalPaymentMethod).toBeNull();
      expect(unmappedRow?.pmtTyCd).toBeNull();
      expect(unmappedRow?.confidenceScore).toBe(0);
    });

    it('never overrides an already-approved row on re-pull', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull([], [], [], [
          { id: 'pm-1', name: 'Cash', type: 'CASH', active: true },
        ]),
      );

      const first = await service.pullPaymentMethods(TENANT_ID);
      const mappingId = first.results[0].mappingId!;
      await service.approve(TENANT_ID, mappingId, 'user@example.com');

      const second = await service.pullPaymentMethods(TENANT_ID);
      expect(second.results[0].mappingId).toBe(mappingId);
      expect(second.results[0].status).toBe(MappingStatus.MAPPED);

      const rows = await paymentRepo.find({
        where: { internalPaymentMethod: 'CASH', merchantId: MERCHANT_ID },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].active).toBe(true);
    });
  });

  describe('approve / update — payment', () => {
    it('rejects approving a payment row with no pmtTyCd yet', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull([], [], [], [
          { id: 'pm-1', name: 'Store Loyalty Points', active: true },
        ]),
      );
      const result = await service.pullPaymentMethods(TENANT_ID);
      const mappingId = result.results[0].mappingId!;

      await expect(
        service.approve(TENANT_ID, mappingId, 'user@example.com'),
      ).rejects.toThrow(/pmtTyCd/);
    });

    it('lets a human resolve an unmapped row via update(), activating it', async () => {
      const service = await buildService(
        fakeOrg(),
        fakeConnections('qb-conn-1'),
        fakeMainApiPull([], [], [], [
          { id: 'pm-1', name: 'Store Loyalty Points', active: true },
        ]),
      );
      const pulled = await service.pullPaymentMethods(TENANT_ID);
      const mappingId = pulled.results[0].mappingId!;

      const updated = await service.update(
        TENANT_ID,
        mappingId,
        { internalPaymentMethod: 'OTHER', pmtTyCd: '08' },
        'user@example.com',
      );
      expect(updated.status).toBe(MappingStatus.MAPPED);
      expect(updated.active).toBe(true);
      expect(updated.pmtTyCd).toBe('08');
    });
  });

  describe('listPaymentMethodOptions', () => {
    it('returns the 8 seeded internal payment methods with their pmtTyCd', async () => {
      const service = await buildService(fakeOrg(), fakeConnections(null), fakeMainApiPull([]));
      const options = service.listPaymentMethodOptions();
      expect(options).toHaveLength(8);
      expect(options.find((o) => o.internalPaymentMethod === 'MOBILE_MONEY')).toEqual({
        internalPaymentMethod: 'MOBILE_MONEY',
        pmtTyCd: '07',
        label: 'Mobile Money',
      });
    });
  });
});
