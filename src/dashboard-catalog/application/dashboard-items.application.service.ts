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
import { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { mapMainApiItemToRegisterItemInput } from '../../catalog/infrastructure/main-api/main-api-item.mapper';
import { ClassificationMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';

export type PullItemsResult = {
  merchantId: string;
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
    @InjectRepository(ClassificationMappingOrmEntity)
    private readonly clsRepo: Repository<ClassificationMappingOrmEntity>,
  ) {}

  async pullItems(complianceTenantId: string): Promise<PullItemsResult> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);

    // Best-effort: refresh the main API's own cache from QuickBooks first, so
    // the list below isn't stale. A failure here (e.g. QuickBooks token expired)
    // shouldn't block reading whatever the main API already has.
    const quickbooksConnectionId =
      connection.integrations['quickbooks']?.connectionId;
    if (quickbooksConnectionId) {
      try {
        await this.mainApiPull.syncItemsFromBookkeeping(
          connection.mainApiApiKey,
          quickbooksConnectionId,
        );
      } catch (error) {
        this.logger.warn(
          `sync-from-bookkeeping (items) failed for tenant ${complianceTenantId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
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
          // The Mapping Center's Classification tab is where a human
          // resolves this item's itemClsCd/qtyUnitCd/pkgUnitCd (each
          // independently — see ClassificationMappingOrmEntity's doc
          // comment). Only an active (fully approved) row counts here; a
          // still-NEEDS_REVIEW row must not silently leak a partial or
          // auto-matched-but-unconfirmed value into an actual KRA
          // registration call.
          const clsRow = await this.clsRepo.findOne({
            where: {
              merchantId,
              matchType: 'EXTERNAL_ID',
              matchValue: externalId,
              active: true,
            },
          });
          const input = mapMainApiItemToRegisterItemInput({
            merchantId,
            item: mainApiItem,
            classificationCodeOverride: clsRow?.itemClsCd ?? undefined,
            qtyUnitCdOverride: clsRow?.qtyUnitCd ?? undefined,
            packagingUnitCdOverride: clsRow?.pkgUnitCd ?? undefined,
          });
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
      attempted: results.length,
      succeeded: results.filter((r) => r.status === 'ok').length,
      failed: results.filter((r) => r.status === 'error').length,
      results,
    };
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

  async overrideClassification(
    complianceTenantId: string,
    itemId: string,
    classificationCode: string,
  ) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const existing = await this.catalog.getItemById(itemId);
    if (!existing || existing.merchantId !== merchantId) {
      throw new NotFoundException(`Item ${itemId} not found`);
    }

    const result = await this.catalog.registerItem({
      merchantId: existing.merchantId,
      externalId: existing.externalId,
      name: existing.name,
      sku: existing.sku,
      itemType: existing.itemType,
      taxCategory: existing.taxCategory,
      classificationCode,
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
