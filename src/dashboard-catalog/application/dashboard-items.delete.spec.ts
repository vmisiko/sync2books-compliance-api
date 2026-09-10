import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DashboardItemsApplicationService } from './dashboard-items.application.service';
import type { CatalogService } from '../../catalog/api/catalog.service';
import type { CatalogItem } from '../../catalog/domain/entities/catalog-item.entity';
import type { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import type { InventoryService } from '../../inventory/api/inventory.service';
import type { InventoryStock } from '../../inventory/domain/entities/inventory-stock.entity';
import type { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import type { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import type { MappingSuggestionService } from '../../regulatory/oscu/application/mapping-suggestion.service';

const TENANT_ID = 'tenant-1';
const MERCHANT_ID = 'merchant-1';

function catalogItem(overrides: Partial<CatalogItem>): CatalogItem {
  return {
    id: 'item-x',
    merchantId: MERCHANT_ID,
    externalId: null,
    name: 'Dawa Cocktail',
    registrationStatus: 'REGISTERED',
    etimsItemCode: 'KE2BCAV0000056',
    deletedAt: null,
    ...overrides,
  } as CatalogItem;
}

function stockRow(
  itemId: string,
  branchId: string,
  qty: number,
): InventoryStock {
  const now = new Date();
  return {
    itemId,
    branchId,
    quantityOnHand: qty,
    reservedQuantity: 0,
    lastMovementAt: now,
    updatedAt: now,
  };
}

function makeService(opts: {
  items: CatalogItem[];
  stock?: Record<string, InventoryStock[]>;
  /** For the pull test only. */
  mainApiItems?: Record<string, unknown>[];
  registerItem?: jest.Mock;
}) {
  const catalog = {
    getItemById: jest.fn((id: string) =>
      Promise.resolve(opts.items.find((i) => i.id === id) ?? null),
    ),
    listItems: jest.fn(() =>
      Promise.resolve({ items: opts.items.filter((i) => !i.deletedAt) }),
    ),
    deleteItem: jest.fn((id: string) =>
      Promise.resolve({
        ...opts.items.find((i) => i.id === id)!,
        deletedAt: new Date(),
      }),
    ),
    registerItem: opts.registerItem ?? jest.fn(),
  };
  const inventory = {
    listStockForItem: jest.fn((id: string) =>
      Promise.resolve(opts.stock?.[id] ?? []),
    ),
    reconcileStock: jest.fn(),
    getStockLevel: jest.fn().mockResolvedValue({ quantityOnHand: 0 }),
  };
  const mainApiConnections = {
    resolveMerchantId: jest.fn().mockResolvedValue(MERCHANT_ID),
    getForTenant: jest.fn().mockResolvedValue({
      mainApiApiKey: 'key-1',
      mainApiCompanyId: 'company-1',
      integrations: { quickbooks: { connectionId: 'conn-1' } },
    }),
  };
  const mainApiPull = {
    syncItemsFromBookkeeping: jest.fn().mockResolvedValue(undefined),
    getItems: jest.fn().mockResolvedValue({
      data: opts.mainApiItems ?? [],
      total: opts.mainApiItems?.length ?? 0,
      page: 1,
      limit: 100,
      totalPages: 1,
    }),
  };

  const service = new DashboardItemsApplicationService(
    catalog as unknown as CatalogService,
    {
      resolveDashboardBranchId: jest.fn().mockResolvedValue('branch-1'),
    } as unknown as ComplianceOrganizationApplicationService,
    mainApiConnections as unknown as MainApiConnectionApplicationService,
    mainApiPull as unknown as MainApiPullClient,
    {
      suggestTaxCodeMapping: jest.fn().mockReturnValue(null),
    } as unknown as MappingSuggestionService,
    inventory as unknown as InventoryService,
  );
  return { service, catalog, inventory };
}

/**
 * The Dawa Cocktail case: one product created twice (by hand in the main API,
 * then again once it reached QuickBooks), both registered with KRA under
 * different itemCds, with stock adjusted onto the one no invoice sells.
 */
const LEGACY = catalogItem({
  id: 'item-legacy',
  externalId: 'ITEM-MTU9XHAJ-NGNGFQ',
  etimsItemCode: 'KE2BCBA0000055',
});
const QUICKBOOKS = catalogItem({
  id: 'item-qb-54',
  externalId: '54',
  sourceSystem: 'QUICKBOOKS',
  etimsItemCode: 'KE2BCAV0000056',
});

describe('DashboardItemsApplicationService.deleteDuplicateItem', () => {
  it('deletes a KRA-registered duplicate that holds no stock', async () => {
    const { service, catalog } = makeService({
      items: [LEGACY, QUICKBOOKS],
      stock: { 'item-legacy': [stockRow('item-legacy', 'branch-1', 0)] },
    });

    const deleted = await service.deleteDuplicateItem(TENANT_ID, 'item-legacy');

    expect(catalog.deleteItem).toHaveBeenCalledWith('item-legacy');
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });

  it('matches twins on normalized name (case and stray whitespace)', async () => {
    const { service, catalog } = makeService({
      items: [LEGACY, { ...QUICKBOOKS, name: '  dawa   COCKTAIL ' }],
    });

    await service.deleteDuplicateItem(TENANT_ID, 'item-legacy');

    expect(catalog.deleteItem).toHaveBeenCalledWith('item-legacy');
  });

  it("refuses to delete a product's only catalog row", async () => {
    const { service, catalog } = makeService({ items: [QUICKBOOKS] });

    await expect(
      service.deleteDuplicateItem(TENANT_ID, 'item-qb-54'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(catalog.deleteItem).not.toHaveBeenCalled();
  });

  it('refuses while the item still holds stock, summed across every branch row', async () => {
    const { service, catalog } = makeService({
      items: [LEGACY, QUICKBOOKS],
      // A leftover '00'-keyed row next to the canonical one -- both count.
      stock: {
        'item-legacy': [
          stockRow('item-legacy', '00', 0),
          stockRow('item-legacy', 'branch-1', 30),
        ],
      },
    });

    await expect(
      service.deleteDuplicateItem(TENANT_ID, 'item-legacy'),
    ).rejects.toThrow(/still holds 30 in stock/);
    expect(catalog.deleteItem).not.toHaveBeenCalled();
  });

  it("404s for another merchant's item, without revealing it exists", async () => {
    const { service, catalog } = makeService({
      items: [
        { ...LEGACY, merchantId: 'merchant-other' },
        { ...QUICKBOOKS, merchantId: 'merchant-other' },
      ],
    });

    await expect(
      service.deleteDuplicateItem(TENANT_ID, 'item-legacy'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(catalog.deleteItem).not.toHaveBeenCalled();
  });

  it('404s for an item that is already deleted', async () => {
    const { service } = makeService({
      items: [{ ...LEGACY, deletedAt: new Date() }, QUICKBOOKS],
    });

    await expect(
      service.deleteDuplicateItem(TENANT_ID, 'item-legacy'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DashboardItemsApplicationService.pullItems -- deleted duplicates', () => {
  it("does not reconcile the ERP's quantity into a deleted item", async () => {
    const { service, inventory } = makeService({
      items: [],
      mainApiItems: [
        {
          id: 'main-1',
          bookId: '54',
          itemCode: 'ITEM-1',
          name: 'Dawa Cocktail',
          bookType: 'quickbooks',
          qtyOnHand: 12,
          standardized: {
            itemType: 'FINISHED_PRODUCT',
            sourceSystem: 'QUICKBOOKS',
          },
        },
      ],
      registerItem: jest.fn().mockResolvedValue({
        item: { ...QUICKBOOKS, deletedAt: new Date() },
        created: false,
        erpBeganTrackingStock: false,
        deleted: true,
      }),
    });

    const result = await service.pullItems(TENANT_ID);

    expect(result.failed).toBe(0);
    expect(inventory.reconcileStock).not.toHaveBeenCalled();
  });
});
