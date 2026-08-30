import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TaxMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';
import { PaymentTypeMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/payment-type-mapping.orm-entity';
import { UnitMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/unit-mapping.orm-entity';
import { MappingSuggestionService } from '../../regulatory/oscu/application/mapping-suggestion.service';
import { OscuCodeOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-code.orm-entity';
import { searchCodes } from '../../catalog/application/use-cases/search-codes.usecase';
import { CatalogService } from '../../catalog/api/catalog.service';
import {
  MainApiItem,
  MainApiPaymentMethod,
  MainApiPullClient,
} from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';
import { MappingStatus } from '../../shared/domain/enums/mapping-status.enum';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';

export type MappingType = 'tax' | 'payment' | 'quantity_unit';

/** KRA cdCls for the Unit of Quantity code list (qtyUnitCd candidates). */
const CD_CLS_QTY_UNIT = '10';

export interface MappingListItem {
  id: string;
  type: MappingType;
  merchantId: string | null;
  scope: 'global' | 'tenant';
  sourceSystem: SourceSystem | null;
  status: MappingStatus;
  confidenceScore: number | null;
  externalValue: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  active: boolean;
  version?: number;
  createdAt: Date;
  updatedAt: Date;
  internalTaxCategory?: string | null;
  taxTyCd?: string | null;
  /** Source system's raw id for this row (e.g. a QuickBooks TaxRate id) — null for manually-created rows. */
  externalId?: string | null;
  /** QuickBooks TaxCode id — what actually gets written to a transaction's TaxCodeRef. Null until a TaxCode pull resolves one for this row's internalTaxCategory. */
  taxCodeId?: string | null;
  /** Raw TaxCode name that resolved taxCodeId, e.g. "16.0% S". */
  taxCodeExternalValue?: string | null;
  /** 0-100 confidence for taxCodeId specifically, independent of confidenceScore (which is TaxRate-derived). */
  taxCodeConfidenceScore?: number | null;
  /**
   * Quantity unit: resolved via the shared unit_mappings category table
   * (see resolveQuantityUnit). Classification code, packaging unit, and
   * product type are per-item, hand-filled directly in Item Sync — see
   * classification-resolver.port.ts's doc comment for why they no longer
   * live here (classification_mappings/the Classification tab were removed
   * 2026-08-27).
   */
  qtyUnitCd?: string | null;
  /** For a payment row: this app's internal payment-method key (e.g. MOBILE_MONEY). */
  internalPaymentMethod?: string | null;
  /** OSCU pmtTyCd (cdCls '07'), e.g. '07' for MOBILE_MONEY. */
  pmtTyCd?: string | null;
  /** For a quantity_unit row: this app's internal unit bucket key (e.g. KILOGRAM, PIECES) — see QTY_UNIT_ALIASES in mapping-suggestion.service.ts. qtyUnitCd above doubles as this row's own target code. */
  internalUnit?: string | null;
}

export interface MappingListFilters {
  source?: string;
  type?: string;
  status?: string;
}

export interface CreateMappingInput {
  type: MappingType;
  internalTaxCategory?: string;
  taxTyCd?: string;
  qtyUnitCd?: string;
  internalPaymentMethod?: string;
  pmtTyCd?: string;
  internalUnit?: string;
}

export interface UpdateMappingInput {
  internalTaxCategory?: string;
  taxTyCd?: string;
  qtyUnitCd?: string;
  internalPaymentMethod?: string;
  pmtTyCd?: string;
  internalUnit?: string;
}

export interface MappingSummary {
  global: { mapped: number; total: number };
  bySource: Array<{ sourceSystem: string; mapped: number; total: number }>;
  overall: { mapped: number; total: number };
}

/**
 * A KRA tax-type code option for the Mapping Center's "KRA Code" dropdown,
 * sourced from oscu_codes (cdCls '04') rather than hardcoded on the
 * frontend — that table is kept current via POST catalog/codes/sync
 * (OSCU /selectCodeList).
 */
export interface TaxCategoryOption {
  /** This app's internal category key (e.g. VAT_STANDARD) — null if a KRA code has no corresponding internal category yet. */
  internalTaxCategory: string | null;
  /** KRA taxTyCd letter, e.g. 'B'. */
  taxTyCd: string;
  /** KRA's own label for the code, e.g. "VAT Standard". */
  cdNm: string;
  /** Display label for the dropdown, e.g. "B — VAT Standard". */
  label: string;
}

export interface PaymentMethodOption {
  /** This app's internal payment-method key, e.g. MOBILE_MONEY. */
  internalPaymentMethod: string;
  /** OSCU pmtTyCd (cdCls '07'), e.g. '07'. */
  pmtTyCd: string;
  /** Display label for the dropdown, e.g. "Mobile Money". */
  label: string;
}

type FoundRow =
  | { type: 'tax'; row: TaxMappingOrmEntity }
  | { type: 'payment'; row: PaymentTypeMappingOrmEntity }
  | { type: 'quantity_unit'; row: UnitMappingOrmEntity };

/**
 * Query-param keys mirror the main API's IntegrationKeyType string values
 * (nest-sync-2-books-api/src/connection/domain/entities/connection.ts)
 * exactly, so a caller who already knows a connection's integrationKey can
 * pass it straight through as ?source= without translating casing/format.
 */
const SOURCE_FILTER: Record<string, SourceSystem> = {
  quickbooks: SourceSystem.QUICKBOOKS,
  xero: SourceSystem.XERO,
  sage: SourceSystem.SAGE,
  odoo: SourceSystem.ODOO,
  'microsoft-dynamics-365-business-central':
    SourceSystem.MICROSOFT_DYNAMICS_365_BUSINESS_CENTRAL,
  manual: SourceSystem.MANUAL,
  api: SourceSystem.API,
};

/**
 * Sources a pull can actually target — mirrors
 * MainApiConnectionApplicationService.SUPPORTED_INTEGRATION_KEYS exactly
 * (the ERP Connection page's real connectable set), not the broader
 * SOURCE_FILTER above, which also accepts `xero`/`sage`/`manual`/`api` for
 * *list filtering* even though none of those have a connection to pull from.
 */
const PULL_SOURCE_KEYS = [
  'quickbooks',
  'odoo',
  'microsoft-dynamics-365-business-central',
] as const;
type PullSource = (typeof PULL_SOURCE_KEYS)[number];

const SOURCE_DISPLAY_NAME: Record<PullSource, string> = {
  quickbooks: 'QuickBooks',
  odoo: 'Odoo',
  'microsoft-dynamics-365-business-central': 'Dynamics 365 Business Central',
};

function resolvePullSource(source: string | undefined): PullSource {
  const key = (source ?? 'quickbooks').toLowerCase();
  if (!(PULL_SOURCE_KEYS as readonly string[]).includes(key)) {
    throw new BadRequestException(
      `Unsupported pull source: ${source}. Must be one of ${PULL_SOURCE_KEYS.join(', ')}`,
    );
  }
  return key as PullSource;
}

const STATUS_FILTER: Record<string, MappingStatus> = {
  mapped: MappingStatus.MAPPED,
  needs_review: MappingStatus.NEEDS_REVIEW,
  unmapped: MappingStatus.UNMAPPED,
  revised: MappingStatus.REVISED,
};

/** Inverse of MappingSuggestionService's TAX_CATEGORY_CODE map — resolves an oscu_codes (cdCls '04') KRA code back to this app's internal category key. */
const TAX_TY_CD_TO_CATEGORY: Record<string, TaxCategory> = {
  A: TaxCategory.EXEMPT,
  B: TaxCategory.VAT_STANDARD,
  C: TaxCategory.VAT_ZERO,
  D: TaxCategory.OTHER,
  E: TaxCategory.VAT_8,
};

/**
 * Backs dashboard-api/mappings — the Mapping Center review workflow. Tax and
 * quantity unit both stay category-based (tax_mappings / unit_mappings,
 * additive columns — see each entity's doc comment) since both are small,
 * closed KRA code lists (5 tax types, ~30 quantity-unit codes) that fit a
 * fix-once-per-source-value model. Classification, packaging unit, and
 * product type are per-item, hand-filled directly in Item Sync instead —
 * see classification-resolver.port.ts's doc comment for why the old
 * classification_mappings-backed Classification tab was removed 2026-08-27
 * (KRA's real classification tree is thousands of rows deep with no shared
 * bucket a heuristic could safely guess, and neither QuickBooks nor Odoo has
 * any packaging concept on an item at all — see
 * ERP_ITEM_FIELD_MAPPING_CAPABILITY_MATRIX.md for the evidence). Global-
 * default rows (merchantId: null) are never written to by this service
 * except that they participate read-only in list()/summary() —
 * approve()/update() reject them (404) since editing a global default here
 * would affect every tenant.
 */
@Injectable()
export class DashboardMappingApplicationService {
  private readonly logger = new Logger(DashboardMappingApplicationService.name);

  constructor(
    @InjectRepository(TaxMappingOrmEntity)
    private readonly taxRepo: Repository<TaxMappingOrmEntity>,
    @InjectRepository(PaymentTypeMappingOrmEntity)
    private readonly paymentRepo: Repository<PaymentTypeMappingOrmEntity>,
    @InjectRepository(UnitMappingOrmEntity)
    private readonly unitRepo: Repository<UnitMappingOrmEntity>,
    @InjectRepository(OscuCodeOrmEntity)
    private readonly oscuCodeRepo: Repository<OscuCodeOrmEntity>,
    private readonly suggestions: MappingSuggestionService,
    private readonly mainApiPull: MainApiPullClient,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly catalog: CatalogService,
  ) {}

  // ---------------------------------------------------------------------
  // KRA reference-data lookups (Assign Classification drawer typeaheads)
  // ---------------------------------------------------------------------

  /**
   * Backs the Assign Classification drawer's KRA classification search —
   * proxies CatalogService.searchItemClassifications (normally reached only
   * via Mode A's ComplianceServiceAuthGuard) behind the dashboard's own JWT
   * guard, since itemClsCd reference data is global/not merchant-scoped and
   * dashboard users have no other route to it.
   */
  async searchItemClassifications(params: {
    query?: string;
    itemClsLvl?: number;
    limit?: number;
  }) {
    return this.catalog.searchItemClassifications(params);
  }

  /**
   * Generic KRA code search — backs the drawer's quantity-unit (cdCls '10')
   * and packaging-unit (cdCls '17') typeaheads. searchCodes is already
   * fully generic (proven for cdCls '04' via listTaxCategoryOptions below),
   * so this just exposes it behind the dashboard guard the same way
   * searchItemClassifications does.
   */
  async searchCodes(params: {
    cdCls?: string;
    query?: string;
    limit?: number;
  }) {
    return searchCodes(params, this.oscuCodeRepo);
  }

  // ---------------------------------------------------------------------
  // Pull + auto-suggest (Track B steps 1 + 3)
  // ---------------------------------------------------------------------

  /**
   * Single entry point for POST dashboard-api/mappings/pull — runs the
   * tax/tax-code pull (unchanged, see pullTaxRates) and the item-derived
   * classification pull (see pullItemClassifications) together, so one
   * dashboard click populates both mapping types instead of requiring a
   * separate action per tab.
   */
  async pullAll(complianceTenantId: string, source?: string) {
    const pullSource = resolvePullSource(source);
    const [tax, classifications, paymentMethods] = await Promise.all([
      this.pullTaxRates(complianceTenantId, pullSource),
      this.pullItemClassifications(complianceTenantId, pullSource),
      this.pullPaymentMethods(complianceTenantId, pullSource),
    ]);
    // tax already carries `source` (see pullTaxRates' return) — no need to
    // repeat it here.
    return { ...tax, classifications, paymentMethods };
  }

  async pullTaxRates(complianceTenantId: string, source?: string) {
    const pullSource = resolvePullSource(source);
    const sourceSystem = SOURCE_FILTER[pullSource];
    const sourceName = SOURCE_DISPLAY_NAME[pullSource];
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    // ensureCompany(), not getForTenant() -- self-heals a mainApiCompanyId
    // that no longer exists on the main API (see 195869c) instead of just
    // reading a stale reference and failing.
    const connection =
      await this.mainApiConnections.ensureCompany(complianceTenantId);
    const connectionId =
      connection.integrations?.[pullSource]?.connectionId ?? null;
    if (!connectionId) {
      throw new BadRequestException(
        `No connected ${sourceName} connection for this tenant yet — connect ${sourceName} before pulling tax rates.`,
      );
    }

    // Best-effort: refresh main API's own tax_rates/tax_codes cache from the
    // source ERP first. Unlike items/customers/invoices, a connection that's
    // never had this called returns nothing here even when the ERP itself
    // has real tax data -- main API never auto-populates these tables on
    // its own. A failure here (e.g. token expired) shouldn't block reading
    // whatever main API already has cached.
    try {
      await this.mainApiPull.syncTaxRatesFromBookkeeping(
        connection.mainApiApiKey,
        connectionId,
      );
    } catch (error) {
      this.logger.warn(
        `sync-from-bookkeeping (tax rates) failed for tenant ${complianceTenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    try {
      await this.mainApiPull.syncTaxCodesFromBookkeeping(
        connection.mainApiApiKey,
        connectionId,
      );
    } catch (error) {
      this.logger.warn(
        `sync-from-bookkeeping (tax codes) failed for tenant ${complianceTenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const response = await this.mainApiPull.getTaxRates(
      connection.mainApiApiKey,
      connectionId,
      {
        status: 'Active',
      },
    );

    const results: Array<{
      externalId: string;
      externalValue: string;
      mappingId: string | null;
      status: MappingStatus;
      confidenceScore: number | null;
      internalTaxCategory: string | null;
    }> = [];

    for (const rate of response.taxRates) {
      const externalValue = rate.displayName || rate.name;
      const suggestion = this.suggestions.suggestTaxMapping(
        rate.name,
        rate.effectiveTaxRate ?? rate.totalTaxRate ?? null,
      );

      if (!suggestion) {
        // No confident auto-suggestion — still persist the row (default
        // confidenceScore 0, no KRA code yet) so it shows up in the Mapping
        // Center table as an Unmapped row a human can pick a code for
        // directly, rather than only ever existing in this transient pull
        // response (see upsertUnmappedTaxRate).
        const row = await this.upsertUnmappedTaxRate(
          merchantId,
          rate.id,
          externalValue,
          sourceSystem,
        );
        results.push({
          externalId: rate.id,
          externalValue,
          mappingId: row.id,
          status: row.status,
          confidenceScore: row.confidenceScore,
          internalTaxCategory: row.internalTaxCategory,
        });
        continue;
      }

      const row = await this.upsertTaxSuggestion(
        merchantId,
        rate.id,
        externalValue,
        suggestion,
        sourceSystem,
      );
      results.push({
        externalId: rate.id,
        externalValue,
        mappingId: row.id,
        status: row.status,
        confidenceScore: row.confidenceScore,
        internalTaxCategory: suggestion.internalTaxCategory,
      });
    }

    const taxCodes = await this.pullTaxCodes(
      merchantId,
      connection.mainApiApiKey,
      connectionId,
      sourceSystem,
    );

    return {
      source: pullSource,
      merchantId,
      attempted: results.length,
      suggested: results.filter((r) => r.status === MappingStatus.NEEDS_REVIEW)
        .length,
      alreadyMapped: results.filter((r) => r.status === MappingStatus.MAPPED)
        .length,
      unmapped: results.filter((r) => r.status === MappingStatus.UNMAPPED)
        .length,
      results,
      taxCodes,
    };
  }

  /**
   * Pulls the connected ERP's PaymentMethod catalog (QuickBooks' Cash/Check/
   * Credit Card/..., or Odoo's pos.payment.method Cash/Card/Customer
   * Account) and auto-suggests each against the 8 internal payment methods
   * via MappingSuggestionService.suggestPaymentMethodMapping, same shape as
   * pullTaxRates above: confident suggestion -> NEEDS_REVIEW row with a
   * pmtTyCd already filled in; no confident suggestion -> UNMAPPED
   * placeholder row a human fills in directly. Payment stays category-keyed
   * (payment_type_mappings, global fallback tier) like tax, not per-item
   * like classification — see the class doc comment.
   */
  async pullPaymentMethods(complianceTenantId: string, source?: string) {
    const pullSource = resolvePullSource(source);
    const sourceSystem = SOURCE_FILTER[pullSource];
    const merchantId = await this.resolveMerchantId(complianceTenantId);

    // The main API's payment-methods live-read now covers QuickBooks and
    // Odoo (PaymentMethodController.getPaymentMethodsForConnection ->
    // PaymentMethodService.getPaymentMethodsLive) -- Dynamics still has no
    // equivalent catalog concept wired up. Skip rather than let that 400
    // reject pullAll()'s Promise.all and take the tax-rate pull down with it.
    if (pullSource !== 'quickbooks' && pullSource !== 'odoo') {
      const results: Array<{
        externalId: string;
        externalValue: string;
        mappingId: string | null;
        status: MappingStatus;
        confidenceScore: number | null;
        internalPaymentMethod: string | null;
      }> = [];
      return {
        merchantId,
        attempted: 0,
        suggested: 0,
        alreadyMapped: 0,
        unmapped: 0,
        results,
        skipped: `Payment method pull is currently only available for QuickBooks and Odoo connections — ${SOURCE_DISPLAY_NAME[pullSource]} has no equivalent payment-method catalog exposed by the main API yet.`,
      };
    }

    const connection =
      await this.mainApiConnections.ensureCompany(complianceTenantId);
    const connectionId =
      connection.integrations?.[pullSource]?.connectionId ?? null;
    if (!connectionId) {
      throw new BadRequestException(
        `No connected ${SOURCE_DISPLAY_NAME[pullSource]} connection for this tenant yet — connect ${SOURCE_DISPLAY_NAME[pullSource]} before pulling payment methods.`,
      );
    }

    const response = await this.mainApiPull.getPaymentMethods(
      connection.mainApiApiKey,
      connectionId,
    );

    const results: Array<{
      externalId: string;
      externalValue: string;
      mappingId: string | null;
      status: MappingStatus;
      confidenceScore: number | null;
      internalPaymentMethod: string | null;
    }> = [];

    for (const method of response.paymentMethods) {
      if (method.active === false) continue;
      const externalValue = method.name;
      const suggestion = this.suggestions.suggestPaymentMethodMapping(
        method.name,
      );

      if (!suggestion) {
        const row = await this.upsertUnmappedPaymentMethod(
          merchantId,
          method.id,
          externalValue,
          sourceSystem,
        );
        results.push({
          externalId: method.id,
          externalValue,
          mappingId: row.id,
          status: row.status,
          confidenceScore: row.confidenceScore,
          internalPaymentMethod: row.internalPaymentMethod,
        });
        continue;
      }

      const row = await this.upsertPaymentMethodSuggestion(
        merchantId,
        method.id,
        externalValue,
        suggestion,
        sourceSystem,
      );
      results.push({
        externalId: method.id,
        externalValue,
        mappingId: row.id,
        status: row.status,
        confidenceScore: row.confidenceScore,
        internalPaymentMethod: suggestion.internalPaymentMethod,
      });
    }

    return {
      merchantId,
      attempted: results.length,
      suggested: results.filter((r) => r.status === MappingStatus.NEEDS_REVIEW)
        .length,
      alreadyMapped: results.filter((r) => r.status === MappingStatus.MAPPED)
        .length,
      unmapped: results.filter((r) => r.status === MappingStatus.UNMAPPED)
        .length,
      results,
    };
  }

  /**
   * Upserts a NEEDS_REVIEW candidate row for (merchantId, internalPaymentMethod).
   * Never touches an already-approved (active: true) row for that key — a
   * fresh pull shouldn't silently override a human decision, it's just
   * reported back as "already mapped" to the caller. Mirrors upsertTaxSuggestion.
   */
  private async upsertPaymentMethodSuggestion(
    merchantId: string,
    externalId: string,
    externalValue: string,
    suggestion: {
      internalPaymentMethod: string;
      pmtTyCd: string;
      confidenceScore: number;
    },
    sourceSystem: SourceSystem,
  ): Promise<PaymentTypeMappingOrmEntity> {
    const approved = await this.paymentRepo.findOne({
      where: {
        merchantId,
        internalPaymentMethod: suggestion.internalPaymentMethod,
        active: true,
      },
    });
    if (approved) return approved;

    const pending = await this.paymentRepo.findOne({
      where: {
        merchantId,
        internalPaymentMethod: suggestion.internalPaymentMethod,
        active: false,
      },
    });

    const patch = {
      merchantId,
      internalPaymentMethod: suggestion.internalPaymentMethod,
      pmtTyCd: suggestion.pmtTyCd,
      sourceSystem,
      status: MappingStatus.NEEDS_REVIEW,
      confidenceScore: suggestion.confidenceScore,
      externalValue,
      externalId,
      active: false,
    };

    if (pending) {
      return this.paymentRepo.save({ ...pending, ...patch });
    }
    return this.paymentRepo.save(
      this.paymentRepo.create({
        id: `paymap-${randomUUID()}`,
        version: 1,
        ...patch,
      }),
    );
  }

  /**
   * Persists a pulled PaymentMethod that MappingSuggestionService couldn't
   * confidently categorize, so it shows up in the Mapping Center table
   * (status UNMAPPED, confidenceScore 0, internalPaymentMethod/pmtTyCd
   * null) instead of only existing in the transient pull response. Mirrors
   * upsertUnmappedTaxRate — keyed by (merchantId, sourceSystem, externalId)
   * so a re-pull refreshes externalValue instead of duplicating, and never
   * resets a row a human has already resolved.
   */
  private async upsertUnmappedPaymentMethod(
    merchantId: string,
    externalId: string,
    externalValue: string,
    sourceSystem: SourceSystem,
  ): Promise<PaymentTypeMappingOrmEntity> {
    const existing = await this.paymentRepo.findOne({
      where: { merchantId, sourceSystem, externalId },
    });
    if (existing) {
      if (existing.active) return existing;
      existing.externalValue = externalValue;
      return this.paymentRepo.save(existing);
    }

    return this.paymentRepo.save(
      this.paymentRepo.create({
        id: `paymap-${randomUUID()}`,
        merchantId,
        internalPaymentMethod: null,
        pmtTyCd: null,
        version: 1,
        active: false,
        sourceSystem,
        status: MappingStatus.UNMAPPED,
        confidenceScore: 0,
        externalValue,
        externalId,
      }),
    );
  }

  private async activatePaymentRow(
    row: PaymentTypeMappingOrmEntity,
  ): Promise<PaymentTypeMappingOrmEntity> {
    return this.paymentRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(PaymentTypeMappingOrmEntity);
      await repo
        .createQueryBuilder()
        .update(PaymentTypeMappingOrmEntity)
        .set({ active: false })
        .where(...merchantIdEquals(row.merchantId))
        .andWhere('internalPaymentMethod = :method', {
          method: row.internalPaymentMethod,
        })
        .andWhere('active = :active', { active: true })
        .andWhere('id != :id', { id: row.id })
        .execute();
      row.active = true;
      return repo.save(row);
    });
  }

  private paymentRowToListItem(
    row: PaymentTypeMappingOrmEntity,
  ): MappingListItem {
    return {
      id: row.id,
      type: 'payment',
      merchantId: row.merchantId,
      scope: row.merchantId ? 'tenant' : 'global',
      sourceSystem: row.sourceSystem,
      status: row.status,
      confidenceScore: row.confidenceScore,
      externalValue: row.externalValue,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      active: row.active,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      externalId: row.externalId,
      internalPaymentMethod: row.internalPaymentMethod,
      pmtTyCd: row.pmtTyCd,
    };
  }

  /**
   * QuickBooks' SalesItemLineDetail.TaxCodeRef needs a TaxCode id, not a
   * TaxRate id — TaxRate is only the percentage detail a TaxCode wraps, it
   * isn't itself assignable to a transaction. Called from pullTaxRates()
   * (same POST dashboard-api/mappings/pull action) so a single pull
   * resolves both the TaxRate-derived internalTaxCategory/taxTyCd (existing
   * behavior, unchanged above) and a real taxCodeId on the same
   * tax_mappings row, via upsertTaxCodeSuggestion's confidence-preferring
   * merge — see that method's doc comment for why a plain overwrite isn't
   * safe here.
   */
  private async pullTaxCodes(
    merchantId: string,
    mainApiApiKey: string,
    connectionId: string,
    sourceSystem: SourceSystem,
  ) {
    const response = await this.mainApiPull.getTaxCodes(
      mainApiApiKey,
      connectionId,
      { active: true },
    );

    const results: Array<{
      externalId: string;
      externalValue: string;
      mappingId: string | null;
      status: MappingStatus | null;
      confidenceScore: number | null;
      internalTaxCategory: string | null;
      taxCodeId: string | null;
    }> = [];

    for (const code of response.taxCodes) {
      const suggestion = this.suggestions.suggestTaxCodeMapping(code.name);

      if (!suggestion) {
        results.push({
          externalId: code.id,
          externalValue: code.name,
          mappingId: null,
          status: MappingStatus.UNMAPPED,
          confidenceScore: null,
          internalTaxCategory: null,
          taxCodeId: null,
        });
        continue;
      }

      const row = await this.upsertTaxCodeSuggestion(
        merchantId,
        code.id,
        code.name,
        suggestion,
        sourceSystem,
      );
      results.push({
        externalId: code.id,
        externalValue: code.name,
        mappingId: row.id,
        status: row.status,
        confidenceScore: suggestion.confidenceScore,
        internalTaxCategory: suggestion.internalTaxCategory,
        taxCodeId: row.taxCodeId,
      });
    }

    return {
      attempted: results.length,
      resolved: results.filter((r) => r.taxCodeId !== null).length,
      unmapped: results.filter((r) => r.status === MappingStatus.UNMAPPED)
        .length,
      results,
    };
  }

  /**
   * Pulls items from the main API (paginated across every page, not just
   * the first) and tallies how many are "ready" — tax AND quantity unit
   * both already resolve to a real KRA code via the Tax Mapping/Quantity
   * Unit tabs' rules — vs. not. Classification code, packaging unit, and
   * product type are always per-item, hand-filled work done directly in
   * Item Sync (see classification-resolver.port.ts's doc comment for why
   * classification_mappings/the old Classification tab were removed
   * 2026-08-27), so this pull no longer creates any row for them — it only
   * surfaces the aggregate readiness banner on the Mapping Center pull
   * result, and as a side effect still upserts unit_mappings suggestions
   * (via resolveQuantityUnit) the same way it always has.
   */
  private async pullItemClassifications(
    complianceTenantId: string,
    source?: string,
  ) {
    const pullSource = resolvePullSource(source);

    // Same story as pullPaymentMethods: no item/product sync exists for
    // Xero/Sage/Dynamics on the main API yet (GET /items only ever reflects
    // QuickBooks/Odoo-sourced items), so there's nothing real to pull for
    // those sources.
    if (pullSource !== 'quickbooks' && pullSource !== 'odoo') {
      return {
        attempted: 0,
        ready: 0,
        notReady: 0,
        skipped: `Item classification pull is currently only available for QuickBooks and Odoo connections — no item/product sync exists yet for ${SOURCE_DISPLAY_NAME[pullSource]}.`,
      };
    }

    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const connection =
      await this.mainApiConnections.ensureCompany(complianceTenantId);
    const connectionId =
      connection.integrations?.[pullSource]?.connectionId ?? null;
    if (!connectionId) {
      throw new BadRequestException(
        `No connected ${SOURCE_DISPLAY_NAME[pullSource]} connection for this tenant yet — connect ${SOURCE_DISPLAY_NAME[pullSource]} before pulling items.`,
      );
    }
    // ensureCompany() above always resolves mainApiCompanyId (creating the
    // main-API company if this is the first call for this tenant), so this
    // should never actually be null -- but GET /items now requires it (see
    // main-api-pull.client.ts's getItems doc comment for why), so guard
    // explicitly rather than letting `string | null` silently widen.
    if (!connection.mainApiCompanyId) {
      throw new BadRequestException(
        'This tenant has no main-API company resolved yet — reconnect an ERP before pulling items.',
      );
    }

    // Best-effort refresh of the main API's own items cache from the source
    // ERP before reading -- without this, a connection that's never had
    // sync-from-bookkeeping called on it silently returns nothing here even
    // when the ERP itself has real product data (see pullTaxRates' identical
    // pattern, and the tax-rates bug this mirrors: a connection with no
    // prior sync call returned 0 rows despite real upstream data existing).
    try {
      await this.mainApiPull.syncItemsFromBookkeeping(
        connection.mainApiApiKey,
        connectionId,
      );
    } catch (error) {
      this.logger.warn(
        `sync-from-bookkeeping (items) failed for tenant ${complianceTenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const items = await this.fetchAllItems(connection.mainApiApiKey, connection.mainApiCompanyId);
    return this.computeItemReadiness(merchantId, items, SOURCE_FILTER[pullSource]);
  }

  /** Loops GET /items across every page — a merchant's full catalog, not just the first page's worth. Capped at 50 pages (5,000 items at the default page size) as a sanity limit against a runaway loop. */
  private async fetchAllItems(apiKey: string, companyId: string): Promise<MainApiItem[]> {
    const items: MainApiItem[] = [];
    let page = 1;
    const limit = 100;
    for (; page <= 50; page++) {
      const response = await this.mainApiPull.getItems(apiKey, companyId, { page, limit });
      items.push(...response.data);
      if (page >= response.totalPages || response.data.length === 0) break;
    }
    return items;
  }

  /**
   * Tallies how many pulled items are "ready" (tax AND quantity unit both
   * resolve to a real KRA code via the shared tax_mappings/unit_mappings
   * rule tables) vs. not — the Mapping Center pull result's aggregate
   * banner, telling a human whether there's an outstanding *rule* gap
   * (fix it here) vs. only the always-manual, always-per-item work
   * (classification code, packaging unit, product type) every item needs
   * regardless, done directly in Item Sync. Deliberately excludes product
   * type: Phase 2 of ITEM_MAPPING_CONSOLIDATION_PLAN.md established there's
   * no rule for it at all, so it can't participate in a "rule gap" framing.
   *
   * resolveQuantityUnit still upserts a unit_mappings suggestion row as a
   * side effect for any never-before-seen raw unit label (unchanged
   * behavior) — this method only stops short of creating any per-item
   * placeholder row, since classification_mappings no longer exists.
   */
  private async computeItemReadiness(
    merchantId: string,
    items: MainApiItem[],
    defaultSourceSystem: SourceSystem,
  ) {
    const matchCache = new Map<
      string,
      { cd: string; confidenceScore: number } | null
    >();
    const taxCache = new Map<string, string | null>();

    let ready = 0;
    let notReady = 0;

    for (const item of items) {
      // Main API's standardization layer normalizes ERP shape (itemType etc.) but
      // deliberately doesn't compute a tax category -- that's KRA-specific
      // classification, which stays this repo's job. Reuse the same
      // MappingSuggestionService heuristic the tax-rate/tax-code pull already
      // uses, against this item's own tax-code-ref label, falling back to
      // OTHER for an unresolvable/missing label rather than blocking the pull.
      const resolvedInternalTaxCategory =
        this.suggestions.suggestTaxCodeMapping(
          item.defaultTaxCodeRef?.name ?? '',
        )?.internalTaxCategory ?? TaxCategory.OTHER;

      // fetchAllItems() pulls every connected ERP's items unfiltered (see its
      // doc comment) -- a company with both QuickBooks and Odoo connected
      // would otherwise have every item mislabeled with whichever single
      // ERP triggered this pull. item.bookType is the accurate per-item
      // source; defaultSourceSystem only covers the (should-be-rare) case
      // of a legacy row with no bookType recorded.
      const itemSourceSystem =
        (item.bookType && SOURCE_FILTER[item.bookType]) || defaultSourceSystem;

      const rawUnit = item.unitOfMeasure ?? '';
      const unitRow = await this.resolveQuantityUnit(
        merchantId,
        rawUnit,
        itemSourceSystem,
        matchCache,
      );

      const resolvedTaxTyCd = await this.resolveTaxTyCdForCategory(
        merchantId,
        resolvedInternalTaxCategory,
        taxCache,
      );

      if (resolvedTaxTyCd && unitRow?.qtyUnitCd) ready++;
      else notReady++;
    }

    return { attempted: items.length, ready, notReady };
  }

  /**
   * Matches a raw ERP unit label directly against the real synced KRA code
   * list for the given cdCls ('10' quantity, '17' packaging) — no internal
   * category table involved. KRA's own codes are already short standard
   * abbreviations (KG, LTR, NO, BX, BG...), so an exact match against the
   * code itself (e.g. "kg" -> cd 'KG') is treated as high confidence; a
   * fuzzy match against the code's name (cdNm) is lower confidence; nothing
   * found returns null, meaning that field genuinely needs human review —
   * there is no default to fall back to.
   */
  private async matchKraCode(
    rawLabel: string,
    cdCls: string,
    cache: Map<string, { cd: string; confidenceScore: number } | null>,
  ): Promise<{ cd: string; confidenceScore: number } | null> {
    const label = rawLabel.trim();
    if (!label) return null;
    const cacheKey = `${cdCls}:${label.toLowerCase()}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;

    const exact = await this.oscuCodeRepo.findOne({
      where: { cdCls, cd: label.toUpperCase(), useYn: 'Y' },
    });
    if (exact) {
      const result = { cd: exact.cd, confidenceScore: 98 };
      cache.set(cacheKey, result);
      return result;
    }

    const fuzzy = await searchCodes(
      { cdCls, query: label, limit: 1 },
      this.oscuCodeRepo,
    );
    const result =
      fuzzy.length > 0 ? { cd: fuzzy[0].cd, confidenceScore: 65 } : null;
    cache.set(cacheKey, result);
    return result;
  }

  /**
   * Quantity unit is category-based (unit_mappings, mirroring tax_mappings)
   * — see unit-mapping.orm-entity.ts's doc comment for why this differs
   * from packaging/classification, which stay per-item. Resolves an
   * internalUnit bucket for the raw ERP label via
   * MappingSuggestionService.suggestQuantityUnitAlias (falling back to the
   * normalized raw label itself when no alias recognizes it, so every
   * distinct unrecognized label still gets its own reviewable row), then
   * upserts/refreshes a unit_mappings row for that bucket — an already-
   * approved row is returned untouched (a human's choice always wins over
   * a fresh pull's guess), same trust model as upsertTaxSuggestion.
   */
  private async resolveQuantityUnit(
    merchantId: string,
    rawUnit: string,
    sourceSystem: SourceSystem,
    matchCache: Map<string, { cd: string; confidenceScore: number } | null>,
  ): Promise<UnitMappingOrmEntity | null> {
    const label = rawUnit.trim();
    if (!label) return null;

    const alias = this.suggestions.suggestQuantityUnitAlias(label);
    const internalUnit = alias?.internalUnit ?? label.toUpperCase();
    const match = await this.matchKraCode(
      alias?.searchTerm ?? label,
      CD_CLS_QTY_UNIT,
      matchCache,
    );

    return this.upsertUnitMapping(
      merchantId,
      internalUnit,
      label,
      match?.cd ?? null,
      // No match at all -> null confidence regardless of alias (a
      // confident alias whose search term still resolved nothing real
      // isn't a confident result). Otherwise, an alias hit is a curated,
      // human-verified pairing (see QTY_UNIT_ALIASES's doc comment)
      // searched against the live code list, not a blind guess — treat it
      // as high-confidence like an exact tax/payment alias match (95),
      // overriding matchKraCode's own exact/fuzzy score for the *search
      // term* it was given.
      match ? (alias ? 95 : match.confidenceScore) : null,
      sourceSystem,
    );
  }

  /**
   * unit_mappings has a unique (merchantId, internalUnit, active) index —
   * mirrors upsertTaxSuggestion's approved-then-pending lookup order and
   * never resets a row a human has already resolved. Unlike tax's split
   * upsertTaxSuggestion/upsertUnmappedTaxRate pair, one method covers both
   * the confident and unconfident cases here: internalUnit is never null
   * (it falls back to the normalized raw label itself in
   * resolveQuantityUnit), so there's no separate "no category yet" key to
   * upsert against the way tax's UNMAPPED rows need externalId instead.
   */
  private async upsertUnitMapping(
    merchantId: string,
    internalUnit: string,
    externalValue: string,
    qtyUnitCd: string | null,
    confidenceScore: number | null,
    sourceSystem: SourceSystem,
  ): Promise<UnitMappingOrmEntity> {
    const approved = await this.unitRepo.findOne({
      where: { merchantId, internalUnit, active: true },
    });
    if (approved) return approved;

    const pending = await this.unitRepo.findOne({
      where: { merchantId, internalUnit, active: false },
    });

    const patch = {
      merchantId,
      internalUnit,
      qtyUnitCd,
      sourceSystem,
      status: qtyUnitCd ? MappingStatus.NEEDS_REVIEW : MappingStatus.UNMAPPED,
      confidenceScore,
      externalValue,
      active: false,
    };

    if (pending) {
      return this.unitRepo.save({ ...pending, ...patch });
    }
    return this.unitRepo.save(
      this.unitRepo.create({
        id: `unitmap-${randomUUID()}`,
        version: 1,
        ...patch,
      }),
    );
  }

  private async activateUnitRow(
    row: UnitMappingOrmEntity,
  ): Promise<UnitMappingOrmEntity> {
    return this.unitRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(UnitMappingOrmEntity);
      await repo
        .createQueryBuilder()
        .update(UnitMappingOrmEntity)
        .set({ active: false })
        .where(...merchantIdEquals(row.merchantId))
        .andWhere('internalUnit = :unit', { unit: row.internalUnit })
        .andWhere('active = :active', { active: true })
        .andWhere('id != :id', { id: row.id })
        .execute();
      row.active = true;
      return repo.save(row);
    });
  }

  private unitRowToListItem(row: UnitMappingOrmEntity): MappingListItem {
    return {
      id: row.id,
      type: 'quantity_unit',
      merchantId: row.merchantId,
      scope: row.merchantId ? 'tenant' : 'global',
      sourceSystem: row.sourceSystem,
      status: row.status,
      confidenceScore: row.confidenceScore,
      externalValue: row.externalValue,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      active: row.active,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      internalUnit: row.internalUnit,
      qtyUnitCd: row.qtyUnitCd,
    };
  }

  /**
   * Upserts a NEEDS_REVIEW candidate row for (merchantId, internalTaxCategory).
   * Never touches an already-approved (active: true) row for that key — a
   * fresh pull shouldn't silently override a human decision, it's just
   * reported back as "already mapped" to the caller.
   */
  private async upsertTaxSuggestion(
    merchantId: string,
    externalId: string,
    externalValue: string,
    suggestion: {
      internalTaxCategory: string;
      taxTyCd: string;
      confidenceScore: number;
    },
    sourceSystem: SourceSystem = SourceSystem.QUICKBOOKS,
  ): Promise<TaxMappingOrmEntity> {
    const approved = await this.taxRepo.findOne({
      where: {
        merchantId,
        internalTaxCategory: suggestion.internalTaxCategory,
        active: true,
      },
    });
    if (approved) return approved;

    const pending = await this.taxRepo.findOne({
      where: {
        merchantId,
        internalTaxCategory: suggestion.internalTaxCategory,
        active: false,
      },
    });

    const patch = {
      merchantId,
      internalTaxCategory: suggestion.internalTaxCategory,
      taxTyCd: suggestion.taxTyCd,
      sourceSystem,
      status: MappingStatus.NEEDS_REVIEW,
      confidenceScore: suggestion.confidenceScore,
      externalValue,
      externalId,
      active: false,
    };

    if (pending) {
      return this.taxRepo.save({ ...pending, ...patch });
    }
    return this.taxRepo.save(
      this.taxRepo.create({
        id: `taxmap-${randomUUID()}`,
        version: 1,
        ...patch,
      }),
    );
  }

  /**
   * Persists a pulled TaxRate that MappingSuggestionService couldn't
   * confidently categorize, so it shows up in the Mapping Center table
   * (status UNMAPPED, confidenceScore 0, internalTaxCategory/taxTyCd null)
   * instead of only existing in the transient pull response — a dashboard
   * user picks the KRA code themselves via the existing Edit/Assign flow
   * (DashboardMappingApplicationService.update), which activates the row
   * (status -> MAPPED) once a code is set.
   *
   * Keyed by (merchantId, sourceSystem, externalId) rather than
   * internalTaxCategory (which is null here) — re-pulling the same
   * unresolved rate refreshes its externalValue instead of creating a
   * duplicate row, and never resets a row a human has already resolved.
   */
  private async upsertUnmappedTaxRate(
    merchantId: string,
    externalId: string,
    externalValue: string,
    sourceSystem: SourceSystem = SourceSystem.QUICKBOOKS,
  ): Promise<TaxMappingOrmEntity> {
    const existing = await this.taxRepo.findOne({
      where: { merchantId, sourceSystem, externalId },
    });
    if (existing) {
      if (existing.active) return existing;
      existing.externalValue = externalValue;
      return this.taxRepo.save(existing);
    }

    return this.taxRepo.save(
      this.taxRepo.create({
        id: `taxmap-${randomUUID()}`,
        merchantId,
        internalTaxCategory: null,
        taxTyCd: null,
        version: 1,
        active: false,
        sourceSystem,
        status: MappingStatus.UNMAPPED,
        confidenceScore: 0,
        externalValue,
        externalId,
      }),
    );
  }

  /**
   * Resolves a taxCodeId onto the (merchantId, internalTaxCategory) row for
   * this suggestion, active-row-first then pending-row, same lookup order
   * as upsertTaxSuggestion. Never touches status/active/approval — enriching
   * an existing row with taxCode metadata is not itself a review decision.
   *
   * The tricky part: tax_mappings has a unique (merchantId,
   * internalTaxCategory, active) index, so at most one row (and therefore
   * one taxCodeId) can exist per category — but several distinct QuickBooks
   * TaxCodes legitimately share a category (e.g. "16.0% S", "16.0% S
   * Import", "16.0% S - RC Imported Services" are all VAT_STANDARD). A
   * naive last-write-wins upsert across a pull's TaxCode loop would let
   * whichever code happens to be processed last silently clobber a better
   * match. Instead this only overwrites taxCodeId when the incoming
   * suggestion's confidence beats the confidence of whatever is already
   * resolved there (taxCodeConfidenceScore), so the plain "<rate>% S" form
   * (highest confidence) wins the slot over its Import/RC variants
   * regardless of pull order.
   *
   * If no tax_mappings row exists yet for this category at all (no TaxRate
   * pull has created one), this creates one sourced purely from the
   * TaxCode data — internalTaxCategory/taxTyCd are derivable from the
   * TaxCode name alone via MappingSuggestionService.suggestTaxCodeMapping.
   */
  private async upsertTaxCodeSuggestion(
    merchantId: string,
    taxCodeId: string,
    taxCodeExternalValue: string,
    suggestion: {
      internalTaxCategory: string;
      taxTyCd: string;
      confidenceScore: number;
    },
    sourceSystem: SourceSystem = SourceSystem.QUICKBOOKS,
  ): Promise<TaxMappingOrmEntity> {
    const applyIfBetter = async (
      row: TaxMappingOrmEntity,
    ): Promise<TaxMappingOrmEntity> => {
      const currentConfidence = row.taxCodeConfidenceScore ?? -1;
      if (row.taxCodeId && suggestion.confidenceScore <= currentConfidence) {
        return row;
      }
      row.taxCodeId = taxCodeId;
      row.taxCodeExternalValue = taxCodeExternalValue;
      row.taxCodeConfidenceScore = suggestion.confidenceScore;
      return this.taxRepo.save(row);
    };

    const approved = await this.taxRepo.findOne({
      where: {
        merchantId,
        internalTaxCategory: suggestion.internalTaxCategory,
        active: true,
      },
    });
    if (approved) return applyIfBetter(approved);

    const pending = await this.taxRepo.findOne({
      where: {
        merchantId,
        internalTaxCategory: suggestion.internalTaxCategory,
        active: false,
      },
    });
    if (pending) return applyIfBetter(pending);

    return this.taxRepo.save(
      this.taxRepo.create({
        id: `taxmap-${randomUUID()}`,
        merchantId,
        internalTaxCategory: suggestion.internalTaxCategory,
        taxTyCd: suggestion.taxTyCd,
        version: 1,
        active: false,
        sourceSystem,
        status: MappingStatus.NEEDS_REVIEW,
        confidenceScore: suggestion.confidenceScore,
        externalValue: null,
        taxCodeId,
        taxCodeExternalValue,
        taxCodeConfidenceScore: suggestion.confidenceScore,
      }),
    );
  }

  // ---------------------------------------------------------------------
  // List / summary
  // ---------------------------------------------------------------------

  async list(
    complianceTenantId: string,
    filters: MappingListFilters,
  ): Promise<MappingListItem[]> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const sourceSystem = this.parseSourceFilter(filters.source);
    const status = this.parseStatusFilter(filters.status);
    const type = this.parseTypeFilter(filters.type);

    const items: MappingListItem[] = [];

    if (!type || type === 'tax') {
      const rows = await this.taxRepo.find({
        where: [
          {
            merchantId,
            ...(sourceSystem ? { sourceSystem } : {}),
            ...(status ? { status } : {}),
          },
          {
            merchantId: IsNull(),
            ...(sourceSystem ? { sourceSystem } : {}),
            ...(status ? { status } : {}),
          },
        ],
      });
      items.push(...rows.map((r) => this.taxRowToListItem(r)));
    }
    if (!type || type === 'payment') {
      const rows = await this.paymentRepo.find({
        where: [
          {
            merchantId,
            ...(sourceSystem ? { sourceSystem } : {}),
            ...(status ? { status } : {}),
          },
          {
            merchantId: IsNull(),
            ...(sourceSystem ? { sourceSystem } : {}),
            ...(status ? { status } : {}),
          },
        ],
      });
      items.push(...rows.map((r) => this.paymentRowToListItem(r)));
    }
    if (!type || type === 'quantity_unit') {
      const rows = await this.unitRepo.find({
        where: [
          {
            merchantId,
            ...(sourceSystem ? { sourceSystem } : {}),
            ...(status ? { status } : {}),
          },
          {
            merchantId: IsNull(),
            ...(sourceSystem ? { sourceSystem } : {}),
            ...(status ? { status } : {}),
          },
        ],
      });
      items.push(...rows.map((r) => this.unitRowToListItem(r)));
    }

    items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return items;
  }

  async summary(complianceTenantId: string): Promise<MappingSummary> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);

    const [taxRows, paymentRows, unitRows] = await Promise.all([
      this.taxRepo.find({ where: [{ merchantId }, { merchantId: IsNull() }] }),
      this.paymentRepo.find({
        where: [{ merchantId }, { merchantId: IsNull() }],
      }),
      this.unitRepo.find({
        where: [{ merchantId }, { merchantId: IsNull() }],
      }),
    ]);

    const isMapped = (s: MappingStatus) =>
      s === MappingStatus.MAPPED || s === MappingStatus.REVISED;
    const all: Array<{
      merchantId: string | null;
      sourceSystem: SourceSystem | null;
      status: MappingStatus;
    }> = [...taxRows, ...paymentRows, ...unitRows];

    const global = all.filter((r) => r.merchantId === null);
    const tenantRows = all.filter((r) => r.merchantId !== null);

    const bySourceMap = new Map<string, { mapped: number; total: number }>();
    for (const r of tenantRows) {
      const key = r.sourceSystem ?? 'UNSPECIFIED';
      const cur = bySourceMap.get(key) ?? { mapped: 0, total: 0 };
      cur.total += 1;
      if (isMapped(r.status)) cur.mapped += 1;
      bySourceMap.set(key, cur);
    }

    return {
      global: {
        mapped: global.filter((r) => isMapped(r.status)).length,
        total: global.length,
      },
      bySource: Array.from(bySourceMap.entries()).map(([sourceSystem, v]) => ({
        sourceSystem,
        ...v,
      })),
      overall: {
        mapped: all.filter((r) => isMapped(r.status)).length,
        total: all.length,
      },
    };
  }

  /**
   * KRA tax-type code options for the Mapping Center's "KRA Code" dropdown —
   * read from oscu_codes (cdCls '04'), which is kept current via POST
   * catalog/codes/sync (OSCU /selectCodeList), instead of a list hardcoded
   * on the frontend. Mirrors MappingSuggestionService's taxTyCd convention
   * (A=EXEMPT, B=VAT_STANDARD, C=VAT_ZERO, D=OTHER, E=VAT_8) to resolve each
   * KRA code back to this app's internal category key.
   */
  async listTaxCategoryOptions(): Promise<TaxCategoryOption[]> {
    const codes = await searchCodes(
      { cdCls: '04', limit: 50 },
      this.oscuCodeRepo,
    );
    return codes.map((c) => ({
      internalTaxCategory: TAX_TY_CD_TO_CATEGORY[c.cd] ?? null,
      taxTyCd: c.cd,
      cdNm: c.cdNm,
      label: `${c.cd} — ${c.cdNm}`,
    }));
  }

  /**
   * The internal-side dropdown options for the Payment mapping tab's
   * Add/Edit modal — the 8 payment methods oscu-mapping.seed.ts seeds
   * globally. Unlike tax categories these are fixed by this app (not
   * queried from oscu_codes), since OSCU's own cdCls '07' list IS the KRA
   * code side already covered generically by searchCodes({cdCls: '07'}) —
   * this just supplies human labels for the internal key half of the pair.
   */
  listPaymentMethodOptions(): PaymentMethodOption[] {
    return [
      { internalPaymentMethod: 'CASH', pmtTyCd: '01', label: 'Cash' },
      { internalPaymentMethod: 'CREDIT', pmtTyCd: '02', label: 'Credit' },
      {
        internalPaymentMethod: 'CASH_CREDIT',
        pmtTyCd: '03',
        label: 'Cash/Credit',
      },
      {
        internalPaymentMethod: 'BANK_CHECK',
        pmtTyCd: '04',
        label: 'Bank Check',
      },
      {
        internalPaymentMethod: 'DEBIT_CREDIT',
        pmtTyCd: '05',
        label: 'Debit & Credit Card',
      },
      { internalPaymentMethod: 'CARD', pmtTyCd: '06', label: 'Card' },
      {
        internalPaymentMethod: 'MOBILE_MONEY',
        pmtTyCd: '07',
        label: 'Mobile Money',
      },
      { internalPaymentMethod: 'OTHER', pmtTyCd: '08', label: 'Other' },
    ];
  }

  // ---------------------------------------------------------------------
  // Approve / edit / manual create
  // ---------------------------------------------------------------------

  async approve(
    complianceTenantId: string,
    id: string,
    approvedBy: string,
  ): Promise<MappingListItem> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const found = await this.findRowById(id);
    if (!found || found.row.merchantId !== merchantId) {
      throw new NotFoundException(`Mapping ${id} not found`);
    }

    if (found.type === 'tax') {
      const row = found.row;
      if (!row.taxTyCd) {
        throw new BadRequestException(
          'Mapping has no target taxTyCd yet — PATCH one in before approving',
        );
      }
      row.status = MappingStatus.MAPPED;
      row.approvedBy = approvedBy;
      row.approvedAt = new Date();
      const saved = await this.activateTaxRow(row);
      return this.taxRowToListItem(saved);
    }

    if (found.type === 'payment') {
      const row = found.row;
      if (!row.pmtTyCd) {
        throw new BadRequestException(
          'Mapping has no target pmtTyCd yet — PATCH one in before approving',
        );
      }
      row.status = MappingStatus.MAPPED;
      row.approvedBy = approvedBy;
      row.approvedAt = new Date();
      const saved = await this.activatePaymentRow(row);
      return this.paymentRowToListItem(saved);
    }

    const row = found.row;
    if (!row.qtyUnitCd) {
      throw new BadRequestException(
        'Mapping has no target qtyUnitCd yet — PATCH one in before approving',
      );
    }
    row.status = MappingStatus.MAPPED;
    row.approvedBy = approvedBy;
    row.approvedAt = new Date();
    const saved = await this.activateUnitRow(row);
    return this.unitRowToListItem(saved);
  }

  async update(
    complianceTenantId: string,
    id: string,
    input: UpdateMappingInput,
    approvedBy: string,
  ): Promise<MappingListItem> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const found = await this.findRowById(id);
    if (!found || found.row.merchantId !== merchantId) {
      throw new NotFoundException(`Mapping ${id} not found`);
    }

    const wasApproved =
      found.row.status === MappingStatus.MAPPED ||
      found.row.status === MappingStatus.REVISED;
    const nextStatus = wasApproved
      ? MappingStatus.REVISED
      : MappingStatus.MAPPED;

    if (found.type === 'tax') {
      const row = found.row;
      if (input.internalTaxCategory)
        row.internalTaxCategory = input.internalTaxCategory;
      if (input.taxTyCd) row.taxTyCd = input.taxTyCd;
      if (!row.taxTyCd) throw new BadRequestException('taxTyCd is required');
      row.status = nextStatus;
      row.approvedBy = approvedBy;
      row.approvedAt = new Date();
      const saved = await this.activateTaxRow(row);
      return this.taxRowToListItem(saved);
    }

    if (found.type === 'payment') {
      const row = found.row;
      if (input.internalPaymentMethod)
        row.internalPaymentMethod = input.internalPaymentMethod;
      if (input.pmtTyCd) row.pmtTyCd = input.pmtTyCd;
      if (!row.pmtTyCd) throw new BadRequestException('pmtTyCd is required');
      row.status = nextStatus;
      row.approvedBy = approvedBy;
      row.approvedAt = new Date();
      const saved = await this.activatePaymentRow(row);
      return this.paymentRowToListItem(saved);
    }

    const row = found.row;
    if (input.internalUnit) row.internalUnit = input.internalUnit;
    if (input.qtyUnitCd) row.qtyUnitCd = input.qtyUnitCd;
    if (!row.qtyUnitCd) throw new BadRequestException('qtyUnitCd is required');
    row.status = nextStatus;
    row.confidenceScore = null; // manually confirmed, not auto-matched anymore
    row.approvedBy = approvedBy;
    row.approvedAt = new Date();
    const saved = await this.activateUnitRow(row);
    return this.unitRowToListItem(saved);
  }

  /**
   * A human explicitly typing a mapping into the dashboard is, by
   * definition, an already-reviewed decision — so manual creation both
   * creates and approves the row in one step (status MAPPED, active
   * immediately, approvedBy/approvedAt stamped now), unlike a QuickBooks-
   * sourced suggestion which starts life as NEEDS_REVIEW.
   */
  async createManual(
    complianceTenantId: string,
    input: CreateMappingInput,
    createdBy: string,
  ): Promise<MappingListItem> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const now = new Date();

    if (input.type === 'tax') {
      if (!input.internalTaxCategory || !input.taxTyCd) {
        throw new BadRequestException(
          'internalTaxCategory and taxTyCd are required for a tax mapping',
        );
      }
      const row = this.taxRepo.create({
        id: `taxmap-${randomUUID()}`,
        merchantId,
        internalTaxCategory: input.internalTaxCategory,
        taxTyCd: input.taxTyCd,
        version: 1,
        active: true,
        sourceSystem: SourceSystem.MANUAL,
        status: MappingStatus.MAPPED,
        confidenceScore: null,
        approvedBy: createdBy,
        approvedAt: now,
        externalValue: null,
      });
      const saved = await this.activateTaxRow(row);
      return this.taxRowToListItem(saved);
    }

    if (input.type === 'payment') {
      if (!input.internalPaymentMethod || !input.pmtTyCd) {
        throw new BadRequestException(
          'internalPaymentMethod and pmtTyCd are required for a payment mapping',
        );
      }
      const row = this.paymentRepo.create({
        id: `paymap-${randomUUID()}`,
        merchantId,
        internalPaymentMethod: input.internalPaymentMethod,
        pmtTyCd: input.pmtTyCd,
        version: 1,
        active: true,
        sourceSystem: SourceSystem.MANUAL,
        status: MappingStatus.MAPPED,
        confidenceScore: null,
        approvedBy: createdBy,
        approvedAt: now,
        externalValue: null,
      });
      const saved = await this.activatePaymentRow(row);
      return this.paymentRowToListItem(saved);
    }

    if (input.type === 'quantity_unit') {
      if (!input.internalUnit || !input.qtyUnitCd) {
        throw new BadRequestException(
          'internalUnit and qtyUnitCd are required for a quantity_unit mapping',
        );
      }
      const row = this.unitRepo.create({
        id: `unitmap-${randomUUID()}`,
        merchantId,
        internalUnit: input.internalUnit,
        qtyUnitCd: input.qtyUnitCd,
        version: 1,
        active: true,
        sourceSystem: SourceSystem.MANUAL,
        status: MappingStatus.MAPPED,
        confidenceScore: null,
        approvedBy: createdBy,
        approvedAt: now,
        externalValue: null,
      });
      const saved = await this.activateUnitRow(row);
      return this.unitRowToListItem(saved);
    }

    throw new BadRequestException(`Unsupported mapping type: ${input.type}`);
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  /**
   * tax_mappings has a unique (merchantId, internalTaxCategory, active)
   * index — at most one active row per merchant+category. Deactivates any
   * other active row for this row's (merchantId, internalTaxCategory) inside
   * a transaction before activating this one, so the constraint is never
   * violated even momentarily.
   */
  private async activateTaxRow(
    row: TaxMappingOrmEntity,
  ): Promise<TaxMappingOrmEntity> {
    return this.taxRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(TaxMappingOrmEntity);
      await repo
        .createQueryBuilder()
        .update(TaxMappingOrmEntity)
        .set({ active: false })
        .where(...merchantIdEquals(row.merchantId))
        .andWhere('internalTaxCategory = :cat', {
          cat: row.internalTaxCategory,
        })
        .andWhere('active = :active', { active: true })
        .andWhere('id != :id', { id: row.id })
        .execute();
      row.active = true;
      return repo.save(row);
    });
  }

  private async findRowById(id: string): Promise<FoundRow | null> {
    if (id.startsWith('taxmap-')) {
      const row = await this.taxRepo.findOne({ where: { id } });
      return row ? { type: 'tax', row } : null;
    }
    if (id.startsWith('paymap-')) {
      const row = await this.paymentRepo.findOne({ where: { id } });
      return row ? { type: 'payment', row } : null;
    }
    if (id.startsWith('unitmap-')) {
      const row = await this.unitRepo.findOne({ where: { id } });
      return row ? { type: 'quantity_unit', row } : null;
    }
    // Defensive fallback for ids that don't follow our prefix convention
    // (shouldn't normally happen — every id this service or the seed
    // creates is prefixed).
    const tax = await this.taxRepo.findOne({ where: { id } });
    if (tax) return { type: 'tax', row: tax };
    const payment = await this.paymentRepo.findOne({ where: { id } });
    if (payment) return { type: 'payment', row: payment };
    const unit = await this.unitRepo.findOne({ where: { id } });
    if (unit) return { type: 'quantity_unit', row: unit };
    return null;
  }

  private taxRowToListItem(row: TaxMappingOrmEntity): MappingListItem {
    return {
      id: row.id,
      type: 'tax',
      merchantId: row.merchantId,
      scope: row.merchantId ? 'tenant' : 'global',
      sourceSystem: row.sourceSystem,
      status: row.status,
      confidenceScore: row.confidenceScore,
      externalValue: row.externalValue,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      active: row.active,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      internalTaxCategory: row.internalTaxCategory,
      taxTyCd: row.taxTyCd,
      externalId: row.externalId,
      taxCodeId: row.taxCodeId,
      taxCodeExternalValue: row.taxCodeExternalValue,
      taxCodeConfidenceScore: row.taxCodeConfidenceScore,
    };
  }

  /** Mirrors ClassificationResolverTypeOrm.resolveTaxTyCd (tenant row first, then global) but returns null instead of throwing when nothing active is found. */
  private async resolveTaxTyCdForCategory(
    merchantId: string,
    internalTaxCategory: string,
    cache?: Map<string, string | null>,
  ): Promise<string | null> {
    if (cache?.has(internalTaxCategory)) return cache.get(internalTaxCategory)!;

    const tenant = await this.taxRepo.findOne({
      where: { merchantId, internalTaxCategory, active: true },
    });
    let result = tenant?.taxTyCd ?? null;
    if (!result) {
      const global = await this.taxRepo.findOne({
        where: { merchantId: IsNull(), internalTaxCategory, active: true },
      });
      result = global?.taxTyCd ?? null;
    }
    cache?.set(internalTaxCategory, result);
    return result;
  }

  private parseSourceFilter(source?: string): SourceSystem | undefined {
    if (!source) return undefined;
    const value = SOURCE_FILTER[source.toLowerCase()];
    if (!value)
      throw new BadRequestException(`Unknown source filter: ${source}`);
    return value;
  }

  private parseStatusFilter(status?: string): MappingStatus | undefined {
    if (!status) return undefined;
    const value = STATUS_FILTER[status.toLowerCase()];
    if (!value)
      throw new BadRequestException(`Unknown status filter: ${status}`);
    return value;
  }

  private parseTypeFilter(type?: string): MappingType | undefined {
    if (!type) return undefined;
    const key = type.toLowerCase();
    if (key === 'tax' || key === 'payment' || key === 'quantity_unit')
      return key;
    throw new BadRequestException(`Unknown type filter: ${type}`);
  }

  private async resolveMerchantId(complianceTenantId: string): Promise<string> {
    const tenant = await this.organization.getTenantById(complianceTenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${complianceTenantId} not found`);
    }
    if (!tenant.sync2booksCompanyId) {
      throw new BadRequestException(
        'This tenant has no sync2booksCompanyId configured — cannot resolve mapping merchantId',
      );
    }
    return tenant.sync2booksCompanyId;
  }
}

/**
 * `merchantId = :merchantId` doesn't match a NULL column under any SQL
 * dialect's three-valued logic, and MySQL's null-safe `<=>` operator (the
 * previous approach here) isn't portable to the sqlite/sqljs driver this
 * repo's lightweight specs run against (see CatalogController's spec) — it
 * throws a syntax error there. In practice activateTaxRow is only ever
 * called with an already-resolved, non-null merchantId (both call sites go
 * through resolveMerchantId(), which throws rather than returning null), so
 * the IS NULL branch is defensive rather than reachable today, but kept for
 * correctness against the entity's nullable merchantId type.
 */
function merchantIdEquals(
  merchantId: string | null,
): [string, Record<string, unknown>] {
  return merchantId === null
    ? ['merchantId IS NULL', {}]
    : ['merchantId = :merchantId', { merchantId }];
}
