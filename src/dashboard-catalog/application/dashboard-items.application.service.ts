import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CatalogService } from '../../catalog/api/catalog.service';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import {
  MainApiConnectionApplicationService,
  SUPPORTED_INTEGRATION_KEYS,
  type SupportedIntegrationKey,
} from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { mapMainApiItemToRegisterItemInput } from '../../catalog/infrastructure/main-api/standardized-item.mapper';
import { ClassificationMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';
import { MappingSuggestionService } from '../../regulatory/oscu/application/mapping-suggestion.service';
import { ItemType } from '../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';
import type { CreateItemDto } from '../presentation/dto/create-item.dto';

/**
 * Mirrors TAX_CATEGORY_CODE in mapping-suggestion.service.ts (kept local
 * since that map isn't exported), inverted: a manually-created item gives us
 * its taxTyCd directly, and this internal bucket is derived from it rather
 * than the other way around. Not sent to KRA — taxTyCd is what matters there.
 */
const TAX_CATEGORY_BY_CODE: Record<string, TaxCategory> = {
  A: TaxCategory.EXEMPT,
  B: TaxCategory.VAT_STANDARD,
  C: TaxCategory.VAT_ZERO,
  D: TaxCategory.OTHER,
  E: TaxCategory.VAT_8,
};

const SOURCE_DISPLAY_NAME: Record<SupportedIntegrationKey, string> = {
  quickbooks: 'QuickBooks',
  odoo: 'Odoo',
  'microsoft-dynamics-365-business-central': 'Dynamics 365 Business Central',
};

/**
 * Mirrors resolveCustomerPullSource in dashboard-customers.application.service.ts:
 * an explicit `source` (the dashboard's ERP selector) always wins; otherwise
 * don't default to QuickBooks blindly -- pick whichever supported integration
 * actually has a connectionId, so an Odoo-only tenant doesn't silently see
 * "0 synced" forever.
 */
function resolveItemPullSource(
  source: string | undefined,
  integrations: Partial<
    Record<SupportedIntegrationKey, { connectionId: string | null }>
  >,
): SupportedIntegrationKey {
  if (source) {
    const key = source.toLowerCase();
    if (!(SUPPORTED_INTEGRATION_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException(
        `Unsupported pull source: ${source}. Must be one of ${SUPPORTED_INTEGRATION_KEYS.join(', ')}`,
      );
    }
    return key as SupportedIntegrationKey;
  }

  const connected = SUPPORTED_INTEGRATION_KEYS.find(
    (key) => integrations?.[key]?.connectionId,
  );
  return connected ?? 'quickbooks';
}

export type PullItemsResult = {
  merchantId: string;
  source: SupportedIntegrationKey;
  attempted: number;
  succeeded: number;
  failed: number;
  results: Array<{
    mainApiItemId: string;
    catalogItemId?: string;
    created?: boolean;
    classificationCode?: string;
    status: 'ok' | 'error';
    error?: string;
  }>;
};

@Injectable()
export class DashboardItemsApplicationService {
  private readonly logger = new Logger(DashboardItemsApplicationService.name);

  constructor(
    private readonly catalog: CatalogService,
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
    private readonly suggestions: MappingSuggestionService,
    @InjectRepository(ClassificationMappingOrmEntity)
    private readonly clsRepo: Repository<ClassificationMappingOrmEntity>,
  ) {}

  async pullItems(
    complianceTenantId: string,
    source?: string,
  ): Promise<PullItemsResult> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);

    const pullSource = resolveItemPullSource(source, connection.integrations);
    const connectionId = connection.integrations[pullSource]?.connectionId;
    if (!connectionId) {
      throw new BadRequestException(
        `No connected ${SOURCE_DISPLAY_NAME[pullSource]} connection for this tenant yet — connect ${SOURCE_DISPLAY_NAME[pullSource]} before pulling items.`,
      );
    }

    // Best-effort: refresh the main API's own cache from the source ERP
    // first, so the list below isn't stale. A failure here (e.g. token
    // expired) shouldn't block reading whatever the main API already has.
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

    const results: PullItemsResult['results'] = [];
    let page = 1;
    const limit = 100;
    let totalPages = 1;

    do {
      const response = await this.mainApiPull.getItems(
        connection.mainApiApiKey,
        {
          page,
          limit,
        },
      );
      totalPages = response.totalPages || 1;

      for (const mainApiItem of response.data) {
        try {
          const externalId = mainApiItem.bookId ?? mainApiItem.itemCode;
          // Main API resolves itemType (ERP-shape normalization) itself, but
          // not tax category — that's KRA-specific classification, still
          // this repo's job. A null `standardized` means this item's source
          // ERP isn't supported by main API's standardization layer yet, so
          // surface a clear per-item error instead of silently registering
          // with an undefined itemType.
          if (!mainApiItem.standardized) {
            throw new Error(
              `Item ${mainApiItem.id} has no standardized itemType — its source ERP is not yet supported by main API's standardization layer`,
            );
          }
          const sourceSystem =
            mainApiItem.standardized?.sourceSystem ??
            mainApiItem.bookType?.toUpperCase() ??
            null;
          // The Mapping Center's Classification tab is where a human
          // resolves this item's itemClsCd/qtyUnitCd/pkgUnitCd (each
          // independently — see ClassificationMappingOrmEntity's doc
          // comment). Only an active (fully approved) row counts here; a
          // still-NEEDS_REVIEW row must not silently leak a partial or
          // auto-matched-but-unconfirmed value into an actual KRA
          // registration call. Scoped by sourceSystem too -- otherwise two
          // ERPs sharing the same small numeric externalId for this merchant
          // would silently resolve to each other's classification (this bit
          // an Odoo pull that collided with pre-existing QuickBooks rows
          // sharing the same bookId — fixed here, not just in the resolver
          // registerItem() falls through to, since this lookup bypasses that
          // resolver entirely).
          const clsRow = await this.clsRepo.findOne({
            where: {
              merchantId,
              matchType: 'EXTERNAL_ID',
              matchValue: externalId,
              sourceSystem,
              active: true,
            },
          });
          const taxCategory =
            this.suggestions.suggestTaxCodeMapping(mainApiItem.defaultTaxCodeRef?.name ?? '')
              ?.internalTaxCategory ?? TaxCategory.OTHER;
          const input = {
            ...mapMainApiItemToRegisterItemInput({
              merchantId,
              item: {
                ...mainApiItem,
                itemType: mainApiItem.standardized.itemType,
              },
              taxCategory,
              classificationCodeOverride: clsRow?.itemClsCd ?? undefined,
              qtyUnitCdOverride: clsRow?.qtyUnitCd ?? undefined,
              packagingUnitCdOverride: clsRow?.pkgUnitCd ?? undefined,
            }),
            sourceSystem,
          };
          const result = await this.catalog.registerItem(input);
          results.push({
            mainApiItemId: mainApiItem.id,
            catalogItemId: result.item.id,
            created: result.created,
            classificationCode: result.item.classificationCode,
            status: 'ok',
          });
        } catch (error) {
          results.push({
            mainApiItemId: mainApiItem.id,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      page += 1;
    } while (page <= totalPages);

    return {
      merchantId,
      source: pullSource,
      attempted: results.length,
      succeeded: results.filter((r) => r.status === 'ok').length,
      failed: results.filter((r) => r.status === 'error').length,
      results,
    };
  }

  /**
   * Create an item manually from the dashboard — no ERP source, so it's
   * never pushed back to QuickBooks. Reuses registerItem's insert path
   * (externalId omitted -> always a fresh row) so it gets the exact same
   * classification resolution and PENDING staging as a pulled item.
   */
  async createItem(complianceTenantId: string, dto: CreateItemDto) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);

    if (!dto.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!['1', '2', '3'].includes(dto.productTypeCode)) {
      throw new BadRequestException(
        "productTypeCode must be '1' (Raw Material), '2' (Finished Product) or '3' (Service)",
      );
    }
    if (!dto.classificationCode?.trim()) {
      throw new BadRequestException('classificationCode is required');
    }
    if (!dto.unitCode?.trim()) {
      throw new BadRequestException('unitCode is required');
    }
    if (!dto.packagingUnitCode?.trim()) {
      throw new BadRequestException('packagingUnitCode is required');
    }
    if (!dto.taxTyCd?.trim()) {
      throw new BadRequestException('taxTyCd is required');
    }

    const isService = dto.productTypeCode === '3';
    const itemType = isService ? ItemType.SERVICE : ItemType.GOODS;
    const taxCategory = TAX_CATEGORY_BY_CODE[dto.taxTyCd] ?? TaxCategory.OTHER;

    const result = await this.catalog.registerItem({
      merchantId,
      name: dto.name,
      sku: dto.sku ?? null,
      itemType,
      taxCategory,
      classificationCode: dto.classificationCode,
      unitCode: dto.unitCode,
      packagingUnitCode: dto.packagingUnitCode,
      taxTyCd: dto.taxTyCd,
      productTypeCode: dto.productTypeCode,
      unitPrice: dto.unitPrice ?? null,
      originCountry: dto.originCountry ?? 'KE',
    });
    return result.item;
  }

  async listItems(complianceTenantId: string) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    return this.catalog.listItems(merchantId);
  }

  /**
   * Sync selected (or all PENDING/FAILED) catalog items to KRA eTIMS via
   * OSCU saveItem. Registering an item (pull/override) only ever writes
   * the local catalog row with status PENDING — this is the step that
   * actually calls out to KRA and flips it to REGISTERED/FAILED.
   */
  async syncItems(complianceTenantId: string, itemIds?: string[]) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const branchId = await this.resolveBranchId(complianceTenantId);
    return this.catalog.syncItems({
      merchantId,
      branchId,
      itemIds: itemIds?.length ? itemIds : undefined,
      onlyPending: true,
    });
  }

  /**
   * Updates a catalog item's fields -- e.g. correcting a `packagingUnitCode`
   * KRA rejected as invalid (see the error text on the item: "...can only be
   * among the following list: [...]"), or any other field the Add Item form
   * collects. Every field is optional; at least one must be supplied.
   *
   * Branches on whether the item came from an ERP pull (`externalId` set) or
   * was created manually:
   * - ERP-sourced: re-runs through `registerItem`'s upsert (same path a pull
   *   would take), so a future pull still finds and updates the same row.
   *   Limited to classification/unit codes -- name/type/tax for an
   *   ERP-sourced item should be fixed at the source, since the next pull
   *   would just overwrite anything else edited here. Must pass
   *   `sourceSystem` through -- `registerItem`'s existing-item lookup is
   *   scoped by it (two ERPs can share the same externalId for this
   *   merchant), so omitting it would silently create a duplicate row
   *   instead of updating the intended one.
   * - Manual entry (no externalId): the full field set is editable, but only
   *   before the item is REGISTERED -- see updateManualItem's doc comment.
   *   `registerItem`'s upsert has nothing to match a manual item against
   *   anyway (no externalId), so it's edited by id instead.
   */
  async updateItem(
    complianceTenantId: string,
    itemId: string,
    overrides: {
      name?: string;
      sku?: string | null;
      classificationCode?: string;
      unitCode?: string;
      packagingUnitCode?: string;
      unitPrice?: number | null;
      originCountry?: string | null;
      taxTyCd?: string;
      productTypeCode?: string;
    },
  ) {
    if (
      overrides.name === undefined &&
      overrides.sku === undefined &&
      overrides.classificationCode === undefined &&
      overrides.unitCode === undefined &&
      overrides.packagingUnitCode === undefined &&
      overrides.unitPrice === undefined &&
      overrides.originCountry === undefined &&
      overrides.taxTyCd === undefined &&
      overrides.productTypeCode === undefined
    ) {
      throw new BadRequestException('Provide at least one field to update');
    }
    if (
      overrides.productTypeCode !== undefined &&
      !['1', '2', '3'].includes(overrides.productTypeCode)
    ) {
      throw new BadRequestException(
        "productTypeCode must be '1' (Raw Material), '2' (Finished Product) or '3' (Service)",
      );
    }

    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const existing = await this.catalog.getItemById(itemId);
    if (!existing || existing.merchantId !== merchantId) {
      throw new NotFoundException(`Item ${itemId} not found`);
    }

    if (!existing.externalId) {
      const itemType =
        overrides.productTypeCode !== undefined
          ? overrides.productTypeCode === '3'
            ? ItemType.SERVICE
            : ItemType.GOODS
          : undefined;
      const taxCategory =
        overrides.taxTyCd !== undefined
          ? TAX_CATEGORY_BY_CODE[overrides.taxTyCd] ?? TaxCategory.OTHER
          : undefined;

      return this.catalog.updateManualItem({
        itemId,
        merchantId,
        name: overrides.name,
        sku: overrides.sku,
        classificationCode: overrides.classificationCode,
        unitCode: overrides.unitCode,
        packagingUnitCode: overrides.packagingUnitCode,
        unitPrice: overrides.unitPrice,
        originCountry: overrides.originCountry,
        itemType,
        taxCategory,
        taxTyCd: overrides.taxTyCd,
        productTypeCode: overrides.productTypeCode,
      });
    }

    const result = await this.catalog.registerItem({
      merchantId: existing.merchantId,
      externalId: existing.externalId,
      sourceSystem: existing.sourceSystem,
      name: existing.name,
      sku: existing.sku,
      itemType: existing.itemType,
      taxCategory: existing.taxCategory,
      classificationCode: overrides.classificationCode ?? existing.classificationCode,
      unitCode: overrides.unitCode ?? existing.unitCode,
      packagingUnitCode: overrides.packagingUnitCode ?? existing.packagingUnitCode,
      unitPrice: existing.unitPrice,
      originCountry: existing.originCountry,
    });
    return result.item;
  }

  private async resolveMerchantId(complianceTenantId: string): Promise<string> {
    const tenant = await this.organization.getTenantById(complianceTenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${complianceTenantId} not found`);
    }
    if (!tenant.sync2booksCompanyId) {
      throw new BadRequestException(
        'This tenant has no sync2booksCompanyId configured — cannot resolve catalog merchantId',
      );
    }
    return tenant.sync2booksCompanyId;
  }

  /**
   * The dashboard has no branch-selection UI yet, so this resolves the
   * tenant's first branch the same way `getOrCreateDefaultBranch` does
   * internally — fine for the common single-branch case this UI targets.
   * `syncItemsToEtims` looks connections up by `sync2booksBranchId`
   * (`IComplianceConnectionRepository.findByMerchantAndBranch`), which is
   * null for branches provisioned only from the dashboard, so that case is
   * surfaced as a clear error rather than a confusing lookup failure.
   */
  private async resolveBranchId(complianceTenantId: string): Promise<string> {
    const branches = await this.organization.listBranches(complianceTenantId);
    const branch = branches[0];
    if (!branch) {
      throw new NotFoundException(
        `No branch configured for tenant ${complianceTenantId}`,
      );
    }
    if (!branch.sync2booksBranchId) {
      throw new BadRequestException(
        `Branch ${branch.id} has no linked sync2books branch id — link an ERP branch before syncing items to KRA`,
      );
    }
    return branch.sync2booksBranchId;
  }
}
