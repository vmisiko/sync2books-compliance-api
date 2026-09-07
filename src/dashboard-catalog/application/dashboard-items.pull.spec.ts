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
  items: ReturnType<typeof mainApiItem>[];
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

  return new DashboardItemsApplicationService(
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
}

/**
 * The ERP refresh is best-effort on purpose (a stale-but-real catalog should still pull), but a
 * failure that leaves nothing behind used to return `attempted: 0` as a success -- rendering in
 * the dashboard as "0 registered, 0 failed" with no hint that anything went wrong.
 */
describe('DashboardItemsApplicationService.pullItems -- failed ERP refresh', () => {
  it('throws with the underlying reason when the refresh failed and nothing was cached', async () => {
    const service = makeService({
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
    const service = makeService({
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
    const service = makeService({
      syncItemsFromBookkeeping: jest.fn().mockResolvedValue(undefined),
      items: [mainApiItem('QB_1')],
    });

    const result = await service.pullItems(TENANT_ID);

    expect(result.succeeded).toBe(1);
    expect(result.warning).toBeUndefined();
  });
});
