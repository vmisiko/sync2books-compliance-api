import { BadGatewayException } from '@nestjs/common';
import { DashboardItemsApplicationService } from './dashboard-items.application.service';
import type { CatalogService } from '../../catalog/api/catalog.service';
import type { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import type { InventoryService } from '../../inventory/api/inventory.service';
import type { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import type { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import type { MappingSuggestionService } from '../../regulatory/oscu/application/mapping-suggestion.service';

const TENANT_ID = 'tenant-1';

function mainApiItem(id: string) {
  return {
    id,
    bookId: id.replace(/^QB_/, ''),
    itemCode: id,
    name: 'Widget',
    bookType: 'quickbooks',
    standardized: { itemType: 'FINISHED_PRODUCT', sourceSystem: 'QUICKBOOKS' },
  };
}

function makeService(overrides: {
  syncItemsFromBookkeeping: jest.Mock;
  items: Record<string, unknown>[];
}) {
  const mainApiConnections = {
    getForTenant: jest.fn().mockResolvedValue({
      mainApiApiKey: 'key-1',
      mainApiCompanyId: 'company-1',
      integrations: { quickbooks: { connectionId: 'conn-1' } },
    }),
    resolveMerchantId: jest.fn().mockResolvedValue('merchant-1'),
  };
  const mainApiPull = {
    syncItemsFromBookkeeping: overrides.syncItemsFromBookkeeping,
    getItems: jest.fn().mockResolvedValue({
      data: overrides.items,
      total: overrides.items.length,
      page: 1,
      limit: 100,
      totalPages: 1,
    }),
  };
  const catalog = {
    registerItem: jest
      .fn()
      .mockResolvedValue({ item: { id: 'catalog-1' }, created: true }),
  };

  const service = new DashboardItemsApplicationService(
    catalog as unknown as CatalogService,
    {
      resolveDashboardBranchId: jest.fn().mockResolvedValue(null),
    } as unknown as ComplianceOrganizationApplicationService,
    mainApiConnections as unknown as MainApiConnectionApplicationService,
    mainApiPull as unknown as MainApiPullClient,
    {
      suggestTaxCodeMapping: jest.fn().mockReturnValue(null),
    } as unknown as MappingSuggestionService,
    { reconcileStock: jest.fn() } as unknown as InventoryService,
  );
  return { service, catalog };
}

/**
 * The ERP refresh is best-effort on purpose (a stale-but-real catalog should still pull), but a
 * failure that leaves nothing behind used to return `attempted: 0` as a success -- rendering in
 * the dashboard as "0 registered, 0 failed" with no hint that anything went wrong.
 */
describe('DashboardItemsApplicationService.pullItems -- failed ERP refresh', () => {
  it('throws with the underlying reason when the refresh failed and nothing was cached', async () => {
    const { service } = makeService({
      syncItemsFromBookkeeping: jest
        .fn()
        .mockRejectedValue(new Error('401 token expired')),
      items: [],
    });

    await expect(service.pullItems(TENANT_ID)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(service.pullItems(TENANT_ID)).rejects.toThrow(
      /401 token expired/,
    );
  });

  it('still registers cached items when the refresh failed, and reports a warning', async () => {
    const { service } = makeService({
      syncItemsFromBookkeeping: jest
        .fn()
        .mockRejectedValue(new Error('401 token expired')),
      items: [mainApiItem('QB_1')],
    });

    const result = await service.pullItems(TENANT_ID);

    expect(result.succeeded).toBe(1);
    expect(result.warning).toMatch(/401 token expired/);
  });

  it('reports no warning on a clean pull', async () => {
    const { service } = makeService({
      syncItemsFromBookkeeping: jest.fn().mockResolvedValue(undefined),
      items: [mainApiItem('QB_1')],
    });

    const result = await service.pullItems(TENANT_ID);

    expect(result.succeeded).toBe(1);
    expect(result.warning).toBeUndefined();
  });
});

/**
 * Main API's Item.toStandardized() covers QuickBooks and Odoo only, so a row from any other ERP
 * -- or one created locally that hasn't synced and so carries no bookType -- comes back with
 * `standardized: null`. That used to throw per item, failing the whole catalogue over a
 * normalization gap upstream (54 items at once, live, 2026-09-10). The raw `itemType` column is
 * on the same payload, so use it.
 */
describe('DashboardItemsApplicationService.pullItems -- items with no standardized shape', () => {
  it('registers a raw service item as a Service rather than failing it', async () => {
    const { service, catalog } = makeService({
      syncItemsFromBookkeeping: jest.fn().mockResolvedValue(undefined),
      items: [
        {
          id: 'x-1',
          bookId: '1',
          itemCode: 'X_1',
          name: 'Consulting',
          bookType: 'xero',
          itemType: 'service',
          standardized: null,
        },
      ],
    });

    const result = await service.pullItems(TENANT_ID);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(catalog.registerItem).toHaveBeenCalledWith(
      expect.objectContaining({ productTypeCode: '3', sourceSystem: 'XERO' }),
    );
  });

  it('registers a raw good with the Finished Product default instead of failing it', async () => {
    const { service, catalog } = makeService({
      syncItemsFromBookkeeping: jest.fn().mockResolvedValue(undefined),
      items: [
        {
          id: 'x-2',
          bookId: '2',
          itemCode: 'X_2',
          name: 'Widget',
          bookType: 'xero',
          itemType: 'Inventory',
          standardized: null,
        },
      ],
    });

    const result = await service.pullItems(TENANT_ID);

    expect(result.succeeded).toBe(1);
    expect(catalog.registerItem).toHaveBeenCalledWith(
      expect.objectContaining({
        productTypeCode: undefined,
        defaultProductTypeCode: '2',
      }),
    );
  });

  it('registers an item with no itemType at all, rather than failing it', async () => {
    const { service, catalog } = makeService({
      syncItemsFromBookkeeping: jest.fn().mockResolvedValue(undefined),
      items: [
        {
          id: 'x-3',
          bookId: '3',
          itemCode: 'X_3',
          name: 'Locally created, never synced',
          standardized: null,
        },
      ],
    });

    const result = await service.pullItems(TENANT_ID);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(catalog.registerItem).toHaveBeenCalledWith(
      expect.objectContaining({
        productTypeCode: undefined,
        defaultProductTypeCode: '2',
        sourceSystem: null,
      }),
    );
  });
});
