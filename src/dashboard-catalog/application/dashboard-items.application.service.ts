import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CatalogService } from '../../catalog/api/catalog.service';
import {
  normalizeItemName,
  type CatalogItem,
} from '../../catalog/domain/entities/catalog-item.entity';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { InventoryService } from '../../inventory/api/inventory.service';
import {
  MainApiConnectionApplicationService,
  SUPPORTED_INTEGRATION_KEYS,
  type SupportedIntegrationKey,
} from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import {
  mapMainApiItemToRegisterItemInput,
  normalizeRawItemType,
} from '../../catalog/infrastructure/main-api/standardized-item.mapper';
import { MappingSuggestionService } from '../../regulatory/oscu/application/mapping-suggestion.service';
import { TAX_CATEGORY_BY_TAX_TY_CD } from '../../regulatory/oscu/mapping/oscu-tax-rates';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';
import type { CreateItemDto } from '../presentation/dto/create-item.dto';

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
  /**
   * Set when the best-effort ERP refresh on the main API failed but the pull carried on against
   * whatever the main API already had cached. Optional and additive so the dashboard can surface
   * it without the two repos having to deploy together. A refresh failure that produced *nothing*
   * throws instead -- see pullItems.
   */
  warning?: string;
  results: Array<{
    mainApiItemId: string;
    catalogItemId?: string;
    created?: boolean;
    classificationCode?: string;
    /**
     * The item registered fine, but something about it needs a human --
     * currently only the first-ERP-quantity conflict below. Distinct from
     * `error`, which means the item did not register at all.
     */
    warning?: string;
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
    private readonly inventory: InventoryService,
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
    // Main API's GET /items now requires companyId/connectionId scoping (it
    // used to leak every company's items to every tenant sharing the main
    // API Application -- see main-api-pull.client.ts's getItems doc
    // comment). mainApiCompanyId should already be set by this point since
    // having a connectionId implies this tenant already went through
    // ensureCompany() during the connect flow, but guard it explicitly
    // rather than letting main API's own 400 surface with less context.
    if (!connection.mainApiCompanyId) {
      throw new BadRequestException(
        'This tenant has no main-API company resolved yet — reconnect an ERP before pulling items.',
      );
    }

    // Best-effort: refresh the main API's own cache from the source ERP
    // first, so the list below isn't stale. A failure here (e.g. token
    // expired) shouldn't block reading whatever the main API already has.
    let refreshError: string | null = null;
    try {
      await this.mainApiPull.syncItemsFromBookkeeping(
        connection.mainApiApiKey,
        connectionId,
      );
    } catch (error) {
      refreshError = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `sync-from-bookkeeping (items) failed for tenant ${complianceTenantId}: ${refreshError}`,
      );
    }

    // Best-effort: stock reconciliation is additive on top of catalog
    // registration, so a tenant with no branch linked yet (or one whose
    // branch isn't wired to a sync2books branch id -- see resolveBranchId's
    // doc comment) should still get its items registered; it just won't get
    // stock reconciled until that's fixed.
    let branchId: string | null = null;
    try {
      branchId = await this.resolveBranchId(complianceTenantId);
    } catch (error) {
      this.logger.warn(
        `Skipping stock reconciliation for tenant ${complianceTenantId}: ${
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
        connection.mainApiCompanyId,
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
          // this repo's job. A null `standardized` means main API's
          // Item.toStandardized() doesn't cover this row's bookType yet (an
          // ERP it hasn't implemented, or a locally-created row that hasn't
          // synced and so has no bookType at all). That used to hard-fail the
          // item, which left whole catalogues unpullable for a normalization
          // gap upstream; fall back to the raw `itemType` column the same
          // pull already carries instead — a Service still resolves to a
          // Service, and anything else takes the mapper's Finished Product
          // default like any other pulled good.
          const itemType =
            mainApiItem.standardized?.itemType ??
            normalizeRawItemType(mainApiItem.itemType);
          const sourceSystem =
            mainApiItem.standardized?.sourceSystem ??
            mainApiItem.bookType?.toUpperCase() ??
            null;
          // Item Sync's Add/Edit/Bulk Edit is the one place classification/
          // packaging/product type get set for an item, directly and
          // immediately -- a pull never supplies them (no ERP tells us
          // classificationCode/pkgUnitCd, and register-item.usecase.ts's
          // existing-preferring fallback means omitting them here is safe:
          // a brand new item lands PENDING with needsClassificationMapping
          // true; an existing item's already-set values are left untouched
          // rather than erased. This replaces a removed
          // classification_mappings-backed lookup that used to run here --
          // see ClassificationMethod's doc comment for why it was removed.
          const taxCategory =
            this.suggestions.suggestTaxCodeMapping(
              mainApiItem.defaultTaxCodeRef?.name ?? '',
            )?.internalTaxCategory ?? TaxCategory.OTHER;
          const input = {
            ...mapMainApiItemToRegisterItemInput({
              merchantId,
              item: {
                ...mainApiItem,
                itemType,
              },
              taxCategory,
            }),
            sourceSystem,
          };
          const result = await this.catalog.registerItem(input);

          // Additive on top of catalog registration: only fires once the
          // item has a real catalog row (registerItem above already
          // returned), and only ever touches the local stock ledger --
          // reconcileStock's own KRA push still gates on etimsItemCode being
          // set, so a PENDING item's stock is tracked locally without
          // anything reaching KRA before it's accepted.
          let warning: string | undefined;
          // A deleted duplicate stays deleted, stock included -- reconciling
          // the ERP's quantity into it would put stock back on a row nobody
          // can see or sell.
          if (branchId && mainApiItem.qtyOnHand != null && !result.deleted) {
            try {
              warning = await this.reconcilePulledQuantity({
                itemId: result.item.id,
                itemName: result.item.name,
                branchId,
                externalQtyOnHand: mainApiItem.qtyOnHand,
                sourceSystem,
                unitPrice: result.item.unitPrice,
                erpBeganTrackingStock: result.erpBeganTrackingStock,
              });
            } catch (error) {
              this.logger.warn(
                `Stock reconciliation failed for item ${result.item.id} ` +
                  `(main API item ${mainApiItem.id}): ${
                    error instanceof Error ? error.message : String(error)
                  }`,
              );
            }
          }

          results.push({
            mainApiItemId: mainApiItem.id,
            catalogItemId: result.item.id,
            created: result.created,
            classificationCode: result.item.classificationCode,
            ...(warning ? { warning } : {}),
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

    // A refresh failure was swallowed above so a stale-but-real catalog still pulls. When it
    // produced nothing at all, though, "0 pulled" is indistinguishable from "the ERP is empty" --
    // so say what actually went wrong instead of reporting an empty success.
    if (results.length === 0 && refreshError) {
      throw new BadGatewayException(
        `Could not refresh ${SOURCE_DISPLAY_NAME[pullSource]} items via the main API, and it has none cached for this business: ${refreshError}`,
      );
    }

    return {
      merchantId,
      source: pullSource,
      attempted: results.length,
      succeeded: results.filter((r) => r.status === 'ok').length,
      failed: results.filter((r) => r.status === 'error').length,
      ...(refreshError
        ? {
            warning: `Showing items already cached by the main API — refreshing from ${SOURCE_DISPLAY_NAME[pullSource]} failed: ${refreshError}`,
          }
        : {}),
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

    const taxCategory =
      TAX_CATEGORY_BY_TAX_TY_CD[dto.taxTyCd] ?? TaxCategory.OTHER;

    const result = await this.catalog.registerItem({
      merchantId,
      name: dto.name,
      sku: dto.sku ?? null,
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
   * Deletes a same-named duplicate from this tenant's catalog -- REGISTERED
   * ones included, which is the whole point: a product created twice (once by
   * hand, again when it reached the ERP) ends up as two KRA items, and stock
   * adjusted on the wrong one silently doesn't count toward sales.
   *
   * Soft delete (see CatalogItem.deletedAt), so history and open drafts that
   * reference the item by id keep working, and a later pull leaves it deleted.
   * KRA is not touched -- OSCU has no way to unregister an itemCd, and the
   * itemCd sequence never reuses one, so the orphaned registration is inert.
   *
   * Refused unless:
   * - another live item in this catalog has the same name, so this can only
   *   ever remove a duplicate, never a product's only row; and
   * - the item holds no stock in any branch. Deleting it with stock on hand
   *   would strand that quantity (and KRA's rsdQty for its itemCd) where
   *   nothing can move it -- move it to the twin with Adjust Stock first.
   */
  async deleteDuplicateItem(
    complianceTenantId: string,
    itemId: string,
  ): Promise<CatalogItem> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const item = await this.catalog.getItemById(itemId);
    if (!item || item.merchantId !== merchantId || item.deletedAt) {
      throw new NotFoundException(`Item ${itemId} not found`);
    }

    const name = normalizeItemName(item.name);
    const { items } = await this.catalog.listItems(merchantId);
    const twins = items.filter(
      (other) => other.id !== item.id && normalizeItemName(other.name) === name,
    );
    if (twins.length === 0) {
      throw new BadRequestException(
        `"${item.name}" is the only catalog item with this name -- only a duplicate can be deleted.`,
      );
    }

    const rows = await this.inventory.listStockForItem(item.id);
    const onHand = rows.reduce((sum, row) => sum + row.quantityOnHand, 0);
    const reserved = rows.reduce((sum, row) => sum + row.reservedQuantity, 0);
    if (onHand !== 0 || reserved !== 0) {
      throw new BadRequestException(
        `"${item.name}" (${item.etimsItemCode ?? 'not registered'}) still holds ${onHand} in stock` +
          (reserved ? ` (${reserved} reserved)` : '') +
          ` -- move it to the item you're keeping with Adjust Stock, then delete this one.`,
      );
    }

    const deleted = await this.catalog.deleteItem(item.id);
    this.logger.log(
      `Deleted duplicate catalog item ${item.id} (${item.etimsItemCode ?? 'unregistered'}) ` +
        `for merchant ${merchantId}; kept ${twins.map((t) => t.id).join(', ')}`,
    );
    return deleted as CatalogItem;
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
   *   name/tax stay fixed at the source (the next pull would just overwrite
   *   anything else edited here) -- but productTypeCode IS editable here,
   *   deliberately: an ERP pull can never tell KRA's Raw Material from
   *   Finished Product, so every ERP-sourced good lands with productTypeCode
   *   null (needsProductType true) until a human picks one, exactly like a
   *   manual item with nothing selected -- this is that pick. Must pass
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
    if (!existing || existing.merchantId !== merchantId || existing.deletedAt) {
      throw new NotFoundException(`Item ${itemId} not found`);
    }

    if (!existing.externalId) {
      const taxCategory =
        overrides.taxTyCd !== undefined
          ? (TAX_CATEGORY_BY_TAX_TY_CD[overrides.taxTyCd] ?? TaxCategory.OTHER)
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
      taxCategory: existing.taxCategory,
      classificationCode:
        overrides.classificationCode ?? existing.classificationCode,
      unitCode: overrides.unitCode ?? existing.unitCode,
      packagingUnitCode:
        overrides.packagingUnitCode ?? existing.packagingUnitCode,
      productTypeCode:
        overrides.productTypeCode ?? existing.productTypeCode ?? undefined,
      unitPrice: existing.unitPrice,
      originCountry: existing.originCountry,
    });
    return result.item;
  }

  /**
   * Applies classificationCode/packagingUnitCode/productTypeCode to many
   * catalog items at once — backs Item Sync's multi-select bulk action.
   * This is the single place a bulk classification/packaging fix happens:
   * classification is no longer a Mapping Center rule at all (see
   * classification-resolver.port.ts's doc comment) — each call here goes
   * straight through updateItem, so the already-registered catalog item is
   * fixed immediately, no re-pull needed. Per-item errors (not found, wrong
   * tenant, invalid productTypeCode) are collected into `skipped` rather
   * than failing the whole batch.
   */
  async bulkUpdateItems(
    complianceTenantId: string,
    itemIds: string[],
    overrides: {
      classificationCode?: string;
      packagingUnitCode?: string;
      productTypeCode?: string;
    },
  ): Promise<{ updated: CatalogItem[]; skipped: string[] }> {
    if (
      overrides.classificationCode === undefined &&
      overrides.packagingUnitCode === undefined &&
      overrides.productTypeCode === undefined
    ) {
      throw new BadRequestException('Provide at least one field to update');
    }

    const updated: CatalogItem[] = [];
    const skipped: string[] = [];
    for (const itemId of itemIds) {
      try {
        updated.push(
          await this.updateItem(complianceTenantId, itemId, overrides),
        );
      } catch {
        skipped.push(itemId);
      }
    }
    return { updated, skipped };
  }

  /**
   * Applies one pulled `qtyOnHand` to local stock -- except on the single
   * occasion where doing so would silently destroy a quantity nobody else
   * holds.
   *
   * On QuickBooks Essentials and Simple Start there is no inventory feature,
   * so no `qtyOnHand` ever arrives and a merchant's goods are stocked by hand
   * through the dashboard (and pushed to KRA from there). The day they
   * upgrade to Plus, or convert an item to Inventory, the ERP starts
   * answering -- and a freshly converted Inventory item typically starts at
   * **0**, because opening quantities are entered separately if at all.
   *
   * A plain reconcile at that moment computes `0 - 52`, writes it, and pushes
   * `rsdQty: 0` to KRA for an item with 52 units physically on the shelf.
   * That is a wrong tax filing arriving through a routine "Pull items", with
   * nothing on screen to say it happened.
   *
   * So on that first-ever ERP quantity, when the two disagree and the local
   * figure is not zero, the reconcile is skipped and reported instead. Not
   * blocked forever and not resolved by guessing -- the house rule is to
   * surface a conflict between two legitimate numbers rather than pick one
   * (see the tax-convention decision). A human reconciles deliberately from
   * the Inventory page, and every pull after that is ordinary: `stockTracked`
   * is true by then, so this only ever fires once per item.
   *
   * Returns a warning for the pull result, or undefined when the reconcile
   * went through normally.
   */
  private async reconcilePulledQuantity(params: {
    itemId: string;
    itemName: string;
    branchId: string;
    externalQtyOnHand: number;
    sourceSystem: string | null;
    unitPrice: number | null;
    erpBeganTrackingStock: boolean;
  }): Promise<string | undefined> {
    if (params.erpBeganTrackingStock) {
      const local = await this.inventory.getStockLevel(
        params.itemId,
        params.branchId,
      );
      if (
        local.quantityOnHand !== 0 &&
        local.quantityOnHand !== params.externalQtyOnHand
      ) {
        const message =
          `${params.itemName}: this ERP has started tracking stock for this item ` +
          `and reports ${params.externalQtyOnHand}, but ${local.quantityOnHand} ` +
          `is tracked here from manual adjustments the ERP has never seen. Left ` +
          `at ${local.quantityOnHand} — reconcile it from the Inventory page once ` +
          `you know which figure is right.`;
        this.logger.warn(
          `First ERP quantity for item ${params.itemId} disagrees with local stock ` +
            `(erp=${params.externalQtyOnHand} local=${local.quantityOnHand}); ` +
            `skipping reconcile so the manual figure is not overwritten`,
        );
        return message;
      }
    }

    await this.inventory.reconcileStock({
      itemId: params.itemId,
      branchId: params.branchId,
      externalQtyOnHand: params.externalQtyOnHand,
      sourceSystem: params.sourceSystem ?? undefined,
      unitPrice: params.unitPrice ?? undefined,
    });
    return undefined;
  }

  private async resolveMerchantId(complianceTenantId: string): Promise<string> {
    return this.mainApiConnections.resolveMerchantId(complianceTenantId);
  }

  /** Mode B branch resolution — see resolveDashboardBranchId's doc comment. */
  private async resolveBranchId(complianceTenantId: string): Promise<string> {
    return this.organization.resolveDashboardBranchId(complianceTenantId);
  }
}
