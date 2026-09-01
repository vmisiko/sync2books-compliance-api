import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { registerItem } from '../application/use-cases/register-item.usecase';
import {
  updateManualItem,
  type UpdateManualItemInput,
} from '../application/use-cases/update-manual-item.usecase';
import { listItems } from '../application/use-cases/list-items.usecase';
import { syncItemsToEtims } from '../application/use-cases/sync-items.usecase';
import {
  resyncItemCdSequenceFromKra,
  type ResyncItemCdSequenceInput,
  type ResyncItemCdSequenceResult,
} from '../application/use-cases/resync-item-cd-sequence.usecase';
import {
  searchItemClassifications,
  type SearchItemClassificationsInput,
} from '../application/use-cases/search-item-classifications.usecase';
import {
  syncItemClassifications,
  type SyncItemClassificationsInput,
  type SyncItemClassificationsResult,
} from '../application/use-cases/sync-item-classifications.usecase';
import {
  listCodeClasses,
  searchCodes,
  type SearchCodesInput,
} from '../application/use-cases/search-codes.usecase';
import {
  syncCodeList,
  type SyncCodeListInput,
  type SyncCodeListResult,
} from '../application/use-cases/sync-code-list.usecase';
import type { ICatalogItemRepository } from '../domain/ports/item-repository.port';
import type { IClassificationResolver } from '../domain/ports/classification-resolver.port';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';
import { ConnectionEnvironment } from '../../shared/domain/enums/connection-environment.enum';
import {
  CATALOG_ITEM_REPO,
  CLASSIFICATION_RESOLVER,
  CONNECTION_REPO,
  ETIMS_ADAPTER,
  STOCK_REPO,
} from '../../shared/tokens';
import type { IComplianceConnectionRepository } from '../../shared/ports/repository.port';
import type { IEtimsAdapter } from '../../regulatory/oscu/ports/etims-adapter.port';
import type { IStockRepository } from '../../inventory/domain/ports/stock-repository.port';
import { InventoryService } from '../../inventory/api/inventory.service';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { OscuItemClassificationOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-item-classification.orm-entity';
import { OscuSyncStateOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';
import { OscuCodeClassOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-code-class.orm-entity';
import { OscuCodeOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-code.orm-entity';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @Inject(CATALOG_ITEM_REPO)
    private readonly itemRepo: ICatalogItemRepository,
    @Inject(CLASSIFICATION_RESOLVER)
    private readonly classificationResolver: IClassificationResolver,
    @Inject(CONNECTION_REPO)
    private readonly connectionRepo: IComplianceConnectionRepository,
    @Inject(ETIMS_ADAPTER)
    private readonly etimsAdapter: IEtimsAdapter,
    @Inject(STOCK_REPO)
    private readonly stockRepo: IStockRepository,
    @Inject(forwardRef(() => InventoryService))
    private readonly inventory: InventoryService,
    private readonly organization: ComplianceOrganizationApplicationService,
    @InjectRepository(OscuItemClassificationOrmEntity)
    private readonly itemClassificationRepo: Repository<OscuItemClassificationOrmEntity>,
    @InjectRepository(OscuSyncStateOrmEntity)
    private readonly oscuSyncStateRepo: Repository<OscuSyncStateOrmEntity>,
    @InjectRepository(OscuCodeClassOrmEntity)
    private readonly codeClassRepo: Repository<OscuCodeClassOrmEntity>,
    @InjectRepository(OscuCodeOrmEntity)
    private readonly codeRepo: Repository<OscuCodeOrmEntity>,
  ) {}

  async registerItem(params: {
    merchantId: string;
    /** Omit/null for a manually-created item with no ERP source. */
    externalId?: string | null;
    name: string;
    sku?: string | null;
    taxCategory: TaxCategory;
    classificationCode?: string;
    unitCode?: string;
    internalUnit?: string;
    packagingUnitCode?: string;
    taxTyCd?: string;
    productTypeCode?: string;
    classificationTypeHint?: string;
    unitPrice?: number | null;
    originCountry?: string | null;
    sourceSystem?: string | null;
  }) {
    const result = await registerItem(
      params,
      this.itemRepo,
      this.classificationResolver,
    );
    if (result.item.isStockItem) {
      await this.seedZeroStockRow(params.merchantId, result.item.id);
    }
    return result;
  }

  /**
   * Best-effort: ensure a stock row exists (at 0) in the tenant's default/HQ
   * branch for a newly-registered or re-registered stock item, so it shows
   * up in the dashboard's Inventory "Stock Levels" list immediately rather
   * than being invisible until a reconcile/adjust happens. A 0 delta can
   * never trip the negative-stock guard, and this deliberately writes no
   * StockMovement ledger entry -- it must never throw or block item
   * registration/KRA-sync.
   */
  private async seedZeroStockRow(
    merchantId: string,
    catalogItemId: string,
  ): Promise<void> {
    try {
      const tenant =
        await this.organization.getTenantBySync2booksCompanyId(merchantId);
      if (!tenant) return;
      const branches = await this.organization.listBranches(tenant.id);
      const branchId = branches[0]?.sync2booksBranchId;
      if (!branchId) return;
      await this.stockRepo.applyDelta(catalogItemId, branchId, 0);
    } catch (error) {
      this.logger.warn(
        `Failed to seed zero stock row for item ${catalogItemId} (merchant ${merchantId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async listItems(merchantId: string) {
    return listItems({ merchantId }, this.itemRepo);
  }

  async getItemById(itemId: string) {
    return this.itemRepo.findById(itemId);
  }

  /** See update-manual-item.usecase.ts -- only for items with no externalId. */
  async updateManualItem(input: UpdateManualItemInput) {
    return updateManualItem(input, this.itemRepo, this.classificationResolver);
  }

  async findByExternalId(
    merchantId: string,
    externalId: string,
    sourceSystem?: string | null,
  ) {
    return this.itemRepo.findByMerchantAndExternalId(
      merchantId,
      externalId,
      sourceSystem,
    );
  }

  async syncItems(params: {
    merchantId: string;
    branchId: string;
    itemIds?: string[];
    onlyPending?: boolean;
    force?: boolean;
  }) {
    const result = await syncItemsToEtims(params, {
      itemRepo: this.itemRepo,
      connectionRepo: this.connectionRepo,
      etimsAdapter: this.etimsAdapter,
      syncStateRepo: this.oscuSyncStateRepo,
    });

    // Catches KRA up on any stock this item already had recorded locally
    // (e.g. from "Pull from QuickBooks", which reconciles qtyOnHand
    // immediately on pull -- before this registration step ever runs) --
    // see InventoryService.pushStockMasterCatchUp's doc comment for why
    // that stock never reached KRA on its own. Best-effort: a failure here
    // must not affect the registration result just reported to the caller.
    for (const item of result.results) {
      if (!item.success) continue;
      try {
        await this.inventory.pushStockMasterCatchUp(
          item.itemId,
          params.branchId,
        );
      } catch (error) {
        this.logger.warn(
          `Stock master catch-up failed for item ${item.itemId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return result;
  }

  async resyncItemCdSequenceFromKra(
    params: ResyncItemCdSequenceInput,
  ): Promise<ResyncItemCdSequenceResult> {
    return resyncItemCdSequenceFromKra(params, {
      itemRepo: this.itemRepo,
      connectionRepo: this.connectionRepo,
      etimsAdapter: this.etimsAdapter,
      syncStateRepo: this.oscuSyncStateRepo,
    });
  }

  async searchItemClassifications(params: SearchItemClassificationsInput) {
    return searchItemClassifications(params, this.itemClassificationRepo);
  }

  async getItemClassification(itemClsCd: string) {
    return this.itemClassificationRepo.findOne({ where: { itemClsCd } });
  }

  async syncItemClassifications(params: SyncItemClassificationsInput) {
    return syncItemClassifications(params, {
      connectionRepo: this.connectionRepo,
      etimsAdapter: this.etimsAdapter,
      classificationRepo: this.itemClassificationRepo,
      syncStateRepo: this.oscuSyncStateRepo,
    });
  }

  async listCodeClasses(includeInactive = false) {
    return listCodeClasses(this.codeClassRepo, includeInactive);
  }

  async searchCodes(params: SearchCodesInput) {
    return searchCodes(params, this.codeRepo);
  }

  async syncCodeList(params: SyncCodeListInput) {
    return syncCodeList(params, {
      connectionRepo: this.connectionRepo,
      etimsAdapter: this.etimsAdapter,
      codeClassRepo: this.codeClassRepo,
      codeRepo: this.codeRepo,
      syncStateRepo: this.oscuSyncStateRepo,
    });
  }

  /**
   * Keeps oscu_codes (tax types, payment types, quantity units, ...) and
   * item classifications current without anyone having to remember to hit
   * POST catalog/codes/sync / item-classifications/sync by hand — both were
   * previously manual-only, so a fresh environment's reference tables stayed
   * empty (KRA classification dropdown showing nothing) until someone did.
   *
   * Both OSCU lists are environment-wide, not merchant-scoped, so this only
   * needs *any one* ACTIVE connection per environment to authenticate the
   * pull — not one per merchant. Each usecase already tracks its own
   * lastReqDt watermark, so a daily run only fetches what's new (pass
   * `full: true` — e.g. from the on-demand POST reference-data/sync-now
   * route — to ignore the watermark and re-pull everything). Sandbox and
   * production are synced independently so one having no connection yet (or
   * erroring) doesn't block the other.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async syncReferenceDataFromOscu(
    full = false,
  ): Promise<ReferenceDataSyncEnvironmentResult[]> {
    const results: ReferenceDataSyncEnvironmentResult[] = [];
    for (const environment of [
      ConnectionEnvironment.SANDBOX,
      ConnectionEnvironment.PRODUCTION,
    ]) {
      const connection =
        await this.connectionRepo.findAnyConnected(environment);
      if (!connection) {
        this.logger.log(
          `Skipping OSCU reference-data sync for ${environment}: no ACTIVE connection yet`,
        );
        results.push({ environment, skipped: true });
        continue;
      }

      const params = {
        merchantId: connection.merchantId,
        branchId: connection.branchId,
        full,
      };
      const result: ReferenceDataSyncEnvironmentResult = {
        environment,
        skipped: false,
      };

      try {
        result.codes = await this.syncCodeList(params);
        this.logger.log(
          `Synced OSCU code list for ${environment}: ${result.codes.codesFetched} codes across ${result.codes.groupsFetched} groups`,
        );
      } catch (error) {
        result.codesError =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `OSCU code list sync failed for ${environment}: ${result.codesError}`,
        );
      }

      try {
        result.classifications = await this.syncItemClassifications(params);
        this.logger.log(
          `Synced OSCU item classifications for ${environment}: ${result.classifications.upserted} rows`,
        );
      } catch (error) {
        result.classificationsError =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `OSCU item classification sync failed for ${environment}: ${result.classificationsError}`,
        );
      }

      results.push(result);
    }
    return results;
  }
}

export type ReferenceDataSyncEnvironmentResult = {
  environment: ConnectionEnvironment;
  skipped: boolean;
  codes?: SyncCodeListResult;
  codesError?: string;
  classifications?: SyncItemClassificationsResult;
  classificationsError?: string;
};
