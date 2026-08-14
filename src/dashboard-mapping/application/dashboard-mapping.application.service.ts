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
import { UnitMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/unit-mapping.orm-entity';
import {
  ClassificationMappingOrmEntity,
  ClassificationMatchType,
} from '../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';
import { MappingSuggestionService } from '../../regulatory/oscu/application/mapping-suggestion.service';
import { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';
import { MappingStatus } from '../../shared/domain/enums/mapping-status.enum';

export type MappingType = 'tax' | 'unit' | 'classification';

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
  internalTaxCategory?: string;
  taxTyCd?: string;
  /** QuickBooks TaxCode id — what actually gets written to a transaction's TaxCodeRef. Null until a TaxCode pull resolves one for this row's internalTaxCategory. */
  taxCodeId?: string | null;
  /** Raw TaxCode name that resolved taxCodeId, e.g. "16.0% S". */
  taxCodeExternalValue?: string | null;
  /** 0-100 confidence for taxCodeId specifically, independent of confidenceScore (which is TaxRate-derived). */
  taxCodeConfidenceScore?: number | null;
  internalUnit?: string;
  qtyUnitCd?: string;
  pkgUnitCd?: string;
  matchType?: ClassificationMatchType;
  matchValue?: string;
  itemType?: string | null;
  itemClsCd?: string | null;
  priority?: number;
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
  internalUnit?: string;
  qtyUnitCd?: string;
  pkgUnitCd?: string;
  matchType?: ClassificationMatchType;
  matchValue?: string;
  itemType?: string | null;
  itemClsCd?: string;
  priority?: number;
}

export interface UpdateMappingInput {
  internalTaxCategory?: string;
  taxTyCd?: string;
  internalUnit?: string;
  qtyUnitCd?: string;
  pkgUnitCd?: string;
  matchType?: ClassificationMatchType;
  matchValue?: string;
  itemType?: string | null;
  itemClsCd?: string;
  priority?: number;
}

export interface MappingSummary {
  global: { mapped: number; total: number };
  bySource: Array<{ sourceSystem: string; mapped: number; total: number }>;
  overall: { mapped: number; total: number };
}

type FoundRow =
  | { type: 'tax'; row: TaxMappingOrmEntity }
  | { type: 'unit'; row: UnitMappingOrmEntity }
  | { type: 'classification'; row: ClassificationMappingOrmEntity };

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

const STATUS_FILTER: Record<string, MappingStatus> = {
  mapped: MappingStatus.MAPPED,
  needs_review: MappingStatus.NEEDS_REVIEW,
  unmapped: MappingStatus.UNMAPPED,
  revised: MappingStatus.REVISED,
};

/**
 * Backs dashboard-api/mappings — the Mapping Center review workflow. Reuses
 * the existing tax_mappings/unit_mappings/classification_mappings tables
 * (additive columns only, see the *.orm-entity.ts files) rather than a
 * parallel model, per the Track B brief. Global-default rows (merchantId:
 * null) are never written to by this service except that they participate
 * read-only in list()/summary() — approve()/update() reject them (404) since
 * editing a global default here would affect every tenant.
 */
@Injectable()
export class DashboardMappingApplicationService {
  private readonly logger = new Logger(DashboardMappingApplicationService.name);

  constructor(
    @InjectRepository(TaxMappingOrmEntity)
    private readonly taxRepo: Repository<TaxMappingOrmEntity>,
    @InjectRepository(UnitMappingOrmEntity)
    private readonly unitRepo: Repository<UnitMappingOrmEntity>,
    @InjectRepository(ClassificationMappingOrmEntity)
    private readonly clsRepo: Repository<ClassificationMappingOrmEntity>,
    private readonly suggestions: MappingSuggestionService,
    private readonly mainApiPull: MainApiPullClient,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly organization: ComplianceOrganizationApplicationService,
  ) {}

  // ---------------------------------------------------------------------
  // Pull + auto-suggest (Track B steps 1 + 3)
  // ---------------------------------------------------------------------

  async pullTaxRates(complianceTenantId: string) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    // ensureCompany(), not getForTenant() -- self-heals a mainApiCompanyId
    // that no longer exists on the main API (see 195869c) instead of just
    // reading a stale reference and failing.
    const connection =
      await this.mainApiConnections.ensureCompany(complianceTenantId);
    const quickbooksConnectionId =
      connection.integrations?.quickbooks?.connectionId ?? null;
    if (!quickbooksConnectionId) {
      throw new BadRequestException(
        'No connected QuickBooks connection for this tenant yet — connect QuickBooks before pulling tax rates.',
      );
    }

    const response = await this.mainApiPull.getTaxRates(
      connection.mainApiApiKey,
      quickbooksConnectionId,
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
        // Don't guess wildly, and don't persist a placeholder row either —
        // taxTyCd/internalTaxCategory stay NOT NULL on this table, so a
        // genuinely-unrecognized external rate is just reported back here
        // for now. A dashboard user who knows the right KRA code can still
        // create it directly via POST dashboard-api/mappings.
        results.push({
          externalId: rate.id,
          externalValue,
          mappingId: null,
          status: MappingStatus.UNMAPPED,
          confidenceScore: null,
          internalTaxCategory: null,
        });
        continue;
      }

      const row = await this.upsertTaxSuggestion(
        merchantId,
        externalValue,
        suggestion,
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
      quickbooksConnectionId,
    );

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
      taxCodes,
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
    quickbooksConnectionId: string,
  ) {
    const response = await this.mainApiPull.getTaxCodes(
      mainApiApiKey,
      quickbooksConnectionId,
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
   * Upserts a NEEDS_REVIEW candidate row for (merchantId, internalTaxCategory).
   * Never touches an already-approved (active: true) row for that key — a
   * fresh pull shouldn't silently override a human decision, it's just
   * reported back as "already mapped" to the caller.
   */
  private async upsertTaxSuggestion(
    merchantId: string,
    externalValue: string,
    suggestion: {
      internalTaxCategory: string;
      taxTyCd: string;
      confidenceScore: number;
    },
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
      sourceSystem: SourceSystem.QUICKBOOKS,
      status: MappingStatus.NEEDS_REVIEW,
      confidenceScore: suggestion.confidenceScore,
      externalValue,
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
        sourceSystem: SourceSystem.QUICKBOOKS,
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
    if (!type || type === 'unit') {
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
    if (!type || type === 'classification') {
      // No global (merchantId: null) rows exist for classification today —
      // ClassificationResolverTypeOrm has no global fallback for it either.
      const rows = await this.clsRepo.find({
        where: {
          merchantId,
          ...(sourceSystem ? { sourceSystem } : {}),
          ...(status ? { status } : {}),
        },
      });
      items.push(...rows.map((r) => this.clsRowToListItem(r)));
    }

    items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return items;
  }

  async summary(complianceTenantId: string): Promise<MappingSummary> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);

    const [taxRows, unitRows, clsRows] = await Promise.all([
      this.taxRepo.find({ where: [{ merchantId }, { merchantId: IsNull() }] }),
      this.unitRepo.find({ where: [{ merchantId }, { merchantId: IsNull() }] }),
      this.clsRepo.find({ where: { merchantId } }),
    ]);

    const isMapped = (s: MappingStatus) =>
      s === MappingStatus.MAPPED || s === MappingStatus.REVISED;
    const all: Array<{
      merchantId: string | null;
      sourceSystem: SourceSystem | null;
      status: MappingStatus;
    }> = [...taxRows, ...unitRows, ...clsRows];

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

    if (found.type === 'unit') {
      const row = found.row;
      if (!row.qtyUnitCd || !row.pkgUnitCd) {
        throw new BadRequestException(
          'Mapping has no target unit codes yet — PATCH some in before approving',
        );
      }
      row.status = MappingStatus.MAPPED;
      row.approvedBy = approvedBy;
      row.approvedAt = new Date();
      const saved = await this.activateUnitRow(row);
      return this.unitRowToListItem(saved);
    }

    const row = found.row;
    if (!row.itemClsCd) {
      throw new BadRequestException(
        'Mapping has no target itemClsCd yet — PATCH one in before approving',
      );
    }
    row.status = MappingStatus.MAPPED;
    row.approvedBy = approvedBy;
    row.approvedAt = new Date();
    row.active = true;
    const saved = await this.clsRepo.save(row);
    return this.clsRowToListItem(saved);
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

    if (found.type === 'unit') {
      const row = found.row;
      if (input.internalUnit) row.internalUnit = input.internalUnit;
      if (input.qtyUnitCd) row.qtyUnitCd = input.qtyUnitCd;
      if (input.pkgUnitCd) row.pkgUnitCd = input.pkgUnitCd;
      if (!row.qtyUnitCd || !row.pkgUnitCd)
        throw new BadRequestException('qtyUnitCd and pkgUnitCd are required');
      row.status = nextStatus;
      row.approvedBy = approvedBy;
      row.approvedAt = new Date();
      const saved = await this.activateUnitRow(row);
      return this.unitRowToListItem(saved);
    }

    const row = found.row;
    if (input.matchType) row.matchType = input.matchType;
    if (input.matchValue) row.matchValue = input.matchValue;
    if (input.itemType !== undefined) row.itemType = input.itemType;
    if (input.itemClsCd) row.itemClsCd = input.itemClsCd;
    if (input.priority !== undefined) row.priority = input.priority;
    if (!row.itemClsCd) throw new BadRequestException('itemClsCd is required');
    row.status = nextStatus;
    row.approvedBy = approvedBy;
    row.approvedAt = new Date();
    row.active = true;
    const saved = await this.clsRepo.save(row);
    return this.clsRowToListItem(saved);
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

    if (input.type === 'unit') {
      if (!input.internalUnit || !input.qtyUnitCd || !input.pkgUnitCd) {
        throw new BadRequestException(
          'internalUnit, qtyUnitCd and pkgUnitCd are required for a unit mapping',
        );
      }
      const row = this.unitRepo.create({
        id: `unitmap-${randomUUID()}`,
        merchantId,
        internalUnit: input.internalUnit,
        qtyUnitCd: input.qtyUnitCd,
        pkgUnitCd: input.pkgUnitCd,
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

    if (!input.matchType || !input.matchValue || !input.itemClsCd) {
      throw new BadRequestException(
        'matchType, matchValue and itemClsCd are required for a classification mapping',
      );
    }
    const row = this.clsRepo.create({
      id: `clsmap-${randomUUID()}`,
      merchantId,
      matchType: input.matchType,
      matchValue: input.matchValue,
      itemType: input.itemType ?? null,
      itemClsCd: input.itemClsCd,
      priority: input.priority ?? 100,
      source: 'merchant_override',
      active: true,
      sourceSystem: SourceSystem.MANUAL,
      status: MappingStatus.MAPPED,
      confidenceScore: null,
      approvedBy: createdBy,
      approvedAt: now,
      externalValue: null,
    });
    const saved = await this.clsRepo.save(row);
    return this.clsRowToListItem(saved);
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

  /** Same idea as activateTaxRow, keyed by (merchantId, internalUnit) — see unit_mappings' unique index. */
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

  private async findRowById(id: string): Promise<FoundRow | null> {
    if (id.startsWith('taxmap-')) {
      const row = await this.taxRepo.findOne({ where: { id } });
      return row ? { type: 'tax', row } : null;
    }
    if (id.startsWith('unitmap-')) {
      const row = await this.unitRepo.findOne({ where: { id } });
      return row ? { type: 'unit', row } : null;
    }
    if (id.startsWith('clsmap-')) {
      const row = await this.clsRepo.findOne({ where: { id } });
      return row ? { type: 'classification', row } : null;
    }
    // Defensive fallback for ids that don't follow our prefix convention
    // (shouldn't normally happen — every id this service or the seed
    // creates is prefixed).
    const tax = await this.taxRepo.findOne({ where: { id } });
    if (tax) return { type: 'tax', row: tax };
    const unit = await this.unitRepo.findOne({ where: { id } });
    if (unit) return { type: 'unit', row: unit };
    const cls = await this.clsRepo.findOne({ where: { id } });
    if (cls) return { type: 'classification', row: cls };
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
      taxCodeId: row.taxCodeId,
      taxCodeExternalValue: row.taxCodeExternalValue,
      taxCodeConfidenceScore: row.taxCodeConfidenceScore,
    };
  }

  private unitRowToListItem(row: UnitMappingOrmEntity): MappingListItem {
    return {
      id: row.id,
      type: 'unit',
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
      pkgUnitCd: row.pkgUnitCd,
    };
  }

  private clsRowToListItem(
    row: ClassificationMappingOrmEntity,
  ): MappingListItem {
    return {
      id: row.id,
      type: 'classification',
      merchantId: row.merchantId,
      scope: 'tenant',
      sourceSystem: row.sourceSystem,
      status: row.status,
      confidenceScore: row.confidenceScore,
      externalValue: row.externalValue,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      active: row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      matchType: row.matchType,
      matchValue: row.matchValue,
      itemType: row.itemType,
      itemClsCd: row.itemClsCd,
      priority: row.priority,
    };
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
    if (key === 'tax' || key === 'unit' || key === 'classification') return key;
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
 * throws a syntax error there. In practice activateTaxRow/activateUnitRow
 * are only ever called with an already-resolved, non-null merchantId (both
 * call sites go through resolveMerchantId(), which throws rather than
 * returning null), so the IS NULL branch is defensive rather than reachable
 * today, but kept for correctness against the entities' nullable merchantId type.
 */
function merchantIdEquals(
  merchantId: string | null,
): [string, Record<string, unknown>] {
  return merchantId === null
    ? ['merchantId IS NULL', {}]
    : ['merchantId = :merchantId', { merchantId }];
}
