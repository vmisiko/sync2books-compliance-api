import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CatalogService } from '../../catalog/api/catalog.service';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { InventoryService } from '../../inventory/api/inventory.service';
import {
  MainApiConnectionApplicationService,
  SUPPORTED_INTEGRATION_KEYS,
  type SupportedIntegrationKey,
} from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';

/**
 * Maps a resolved pull-source integration key to the SourceSystem value
 * written into the stock movement row. Kept as a plain string (not the enum
 * type itself) on write since StockMovementOrmEntity.sourceSystem is typed
 * `string | null`, matching the pre-existing hardcoded 'QUICKBOOKS' literal
 * this replaces.
 */
const PULL_SOURCE_TO_SOURCE_SYSTEM: Record<SupportedIntegrationKey, SourceSystem> = {
  quickbooks: SourceSystem.QUICKBOOKS,
  odoo: SourceSystem.ODOO,
  'microsoft-dynamics-365-business-central':
    SourceSystem.MICROSOFT_DYNAMICS_365_BUSINESS_CENTRAL,
};

/**
 * Resolves which ERP a reconcile pull should target -- mirrors
 * resolveCustomerPullSource in dashboard-customers.application.service.ts.
 * An explicit `source` (the dashboard's ERP selector, once connected to more
 * than one integration) always wins. Otherwise, don't default to QuickBooks
 * blindly -- pick whichever supported integration actually has a
 * connectionId instead.
 */
function resolveReconcilePullSource(
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

export type ReconcileResult = {
  merchantId: string;
  branchId: string;
  attempted: number;
  succeeded: number;
  failed: number;
  results: Array<{
    itemId: string;
    status: 'ok' | 'error';
    delta?: number;
    balance?: number;
    error?: string;
  }>;
};

@Injectable()
export class DashboardInventoryApplicationService {
  private readonly logger = new Logger(DashboardInventoryApplicationService.name);

  constructor(
    private readonly inventory: InventoryService,
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly catalog: CatalogService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
  ) {}

  async listBranches(complianceTenantId: string) {
    const tenant = await this.organization.getTenantById(complianceTenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${complianceTenantId} not found`);
    }
    return this.organization.listBranches(complianceTenantId);
  }

  async listStock(branchId?: string) {
    return this.inventory.listStock(branchId);
  }

  async listMovements(params: {
    itemId?: string;
    branchId?: string;
    limit?: number;
  }) {
    return this.inventory.listMovements(params);
  }

  async transfer(input: {
    itemId: string;
    fromBranchId: string;
    toBranchId: string;
    quantity: number;
    unitPrice?: number;
  }) {
    return this.inventory.transferStock({
      itemId: input.itemId,
      fromBranchId: input.fromBranchId,
      receivingItemId: input.itemId,
      toBranchId: input.toBranchId,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
    });
  }

  /**
   * Manual stock add/deduct -- the only way a manually-created item (no
   * QuickBooks source, externalId null) ever gets a quantity: reconcile()
   * only ever walks main-api's item list, so items that don't exist there
   * are never touched by it. Also useful for QuickBooks-sourced items when a
   * one-off correction is needed outside the normal reconcile cycle.
   */
  async adjust(input: {
    itemId: string;
    branchId: string;
    quantity: number;
    action: 'ADD' | 'DEDUCT';
    referenceId?: string;
    unitPrice?: number;
  }) {
    return this.inventory.adjustStock(input);
  }

  /**
   * Pulls each item's current QuickBooks QtyOnHand from the main API (same
   * on-demand pull mechanism as the Items page's "Pull items" action, not a
   * separate push channel) and reconciles it into the default branch's stock,
   * per this session's confirmed decision. Best-effort per item: one item
   * failing (e.g. no default branch link) doesn't block the rest.
   */
  async reconcile(
    complianceTenantId: string,
    source?: string,
  ): Promise<ReconcileResult> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const branchId = await this.resolveDefaultBranchId(complianceTenantId);
    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);

    const pullSource = resolveReconcilePullSource(
      source,
      connection.integrations,
    );
    const connectionId = connection.integrations[pullSource]?.connectionId;
    const sourceSystem = PULL_SOURCE_TO_SOURCE_SYSTEM[pullSource];
    // Main API's GET /items now requires companyId/connectionId scoping --
    // see main-api-pull.client.ts's getItems doc comment for why (it used
    // to leak every company's items to every tenant sharing the main API
    // Application).
    if (!connection.mainApiCompanyId) {
      throw new BadRequestException(
        'This tenant has no main-API company resolved yet — reconnect an ERP before reconciling stock.',
      );
    }
    if (connectionId) {
      try {
        await this.mainApiPull.syncItemsFromBookkeeping(
          connection.mainApiApiKey,
          connectionId,
        );
      } catch (error) {
        this.logger.warn(
          `sync-from-bookkeeping (reconcile) failed for tenant ${complianceTenantId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const results: ReconcileResult['results'] = [];
    let page = 1;
    const limit = 100;
    let totalPages = 1;

    do {
      const response = await this.mainApiPull.getItems(
        connection.mainApiApiKey,
        connection.mainApiCompanyId,
        { page, limit },
      );
      totalPages = response.totalPages || 1;

      for (const mainApiItem of response.data) {
        const externalQtyOnHand = mainApiItem.qtyOnHand;
        if (typeof externalQtyOnHand !== 'number') continue;

        const externalId = mainApiItem.bookId ?? mainApiItem.itemCode;
        const catalogItem = await this.catalog.findByExternalId(
          merchantId,
          externalId,
          sourceSystem,
        );
        if (!catalogItem || !catalogItem.isStockItem) continue;

        try {
          const result = await this.inventory.reconcileStock({
            itemId: catalogItem.id,
            branchId,
            externalQtyOnHand,
            sourceSystem,
            unitPrice: catalogItem.unitPrice ?? undefined,
          });
          results.push({
            itemId: catalogItem.id,
            status: 'ok',
            delta: result.movement.quantity,
            balance: result.stock.quantityOnHand,
          });
        } catch (error) {
          results.push({
            itemId: catalogItem.id,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      page += 1;
    } while (page <= totalPages);

    return {
      merchantId,
      branchId,
      attempted: results.length,
      succeeded: results.filter((r) => r.status === 'ok').length,
      failed: results.filter((r) => r.status === 'error').length,
      results,
    };
  }

  private async resolveMerchantId(complianceTenantId: string): Promise<string> {
    return this.mainApiConnections.resolveMerchantId(complianceTenantId);
  }

  /**
   * Reconciliation always targets the default/HQ branch (this session's
   * confirmed decision) -- redistributing to other branches is a manual
   * internal transfer. Mirrors DashboardItemsApplicationService.resolveBranchId
   * (branches[0], the same "no branch-selection UI yet" convention).
   */
  private async resolveDefaultBranchId(
    complianceTenantId: string,
  ): Promise<string> {
    const branches = await this.organization.listBranches(complianceTenantId);
    const branch = branches[0];
    if (!branch) {
      throw new NotFoundException(
        `No branch configured for tenant ${complianceTenantId}`,
      );
    }
    if (!branch.sync2booksBranchId) {
      throw new BadRequestException(
        `Branch ${branch.id} has no linked sync2books branch id — link an ERP branch before reconciling stock`,
      );
    }
    return branch.sync2booksBranchId;
  }
}
