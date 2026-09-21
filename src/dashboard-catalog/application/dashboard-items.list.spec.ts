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

function catalogItem(id: string): CatalogItem {
  return { id, merchantId: MERCHANT_ID, name: id } as CatalogItem;
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
  /** Every stock row in the table, across tenants -- the fake filters by the ids it is asked for. */
  allStock: InventoryStock[];
  /** The branches this tenant owns. Defaults to the ones the fixtures use. */
  branchIds?: string[];
  /** branch id -> its sync2booksBranchId alias, for tenants that have one. */
  aliases?: Record<string, string>;
}) {
  const catalog = {
    listItems: jest.fn().mockResolvedValue({ items: opts.items }),
  };
  const inventory = {
    listStockForItems: jest.fn((ids: string[]) =>
      Promise.resolve(opts.allStock.filter((s) => ids.includes(s.itemId))),
    ),
  };

  const organization = {
    listBranches: jest.fn().mockResolvedValue(
      (opts.branchIds ?? ['branch-1', 'branch-2']).map((id) => ({
        id,
        sync2booksBranchId: opts.aliases?.[id] ?? null,
      })),
    ),
  };

  const service = new DashboardItemsApplicationService(
    catalog as unknown as CatalogService,
    organization as unknown as ComplianceOrganizationApplicationService,
    {
      resolveMerchantId: jest.fn().mockResolvedValue(MERCHANT_ID),
    } as unknown as MainApiConnectionApplicationService,
    {} as unknown as MainApiPullClient,
    {} as unknown as MappingSuggestionService,
    inventory as unknown as InventoryService,
  );
  return { service, catalog, inventory, organization };
}

describe('DashboardItemsApplicationService.listItems -- embedded stock', () => {
  it("embeds each item's per-branch stock and total", async () => {
    const { service } = makeService({
      items: [catalogItem('a'), catalogItem('b')],
      allStock: [
        stockRow('a', 'branch-1', 4),
        stockRow('a', 'branch-2', 6),
        stockRow('b', 'branch-1', 2),
      ],
    });

    const { items } = await service.listItems(TENANT_ID);

    expect(items.find((i) => i.id === 'a')?.stock.total).toBe(10);
    expect(items.find((i) => i.id === 'a')?.stock.branches).toHaveLength(2);
    expect(items.find((i) => i.id === 'b')?.stock.total).toBe(2);
  });

  it("asks inventory only for this tenant's item ids, so another tenant's stock cannot leak in", async () => {
    const { service, inventory } = makeService({
      items: [catalogItem('mine')],
      allStock: [
        stockRow('mine', 'branch-1', 3),
        stockRow('someone-elses', 'branch-9', 500),
      ],
    });

    const { items } = await service.listItems(TENANT_ID);

    expect(inventory.listStockForItems).toHaveBeenCalledWith(['mine']);
    expect(items).toHaveLength(1);
    expect(items[0].stock.branches.map((b) => b.branchId)).toEqual([
      'branch-1',
    ]);
  });

  it("leaves out stock held on another business's branch, even for the same item id", async () => {
    // Two businesses can share one item id; inventory_stock has no tenant
    // column, so the only thing tying a row to this tenant is its branch.
    const { service, organization } = makeService({
      items: [catalogItem('shared')],
      branchIds: ['branch-1'],
      allStock: [
        stockRow('shared', 'branch-1', 28),
        stockRow('shared', 'other-tenants-branch', 71),
      ],
    });

    const { items } = await service.listItems(TENANT_ID);

    expect(organization.listBranches).toHaveBeenCalledWith(TENANT_ID);
    expect(items[0].stock.total).toBe(28);
    expect(items[0].stock.branches.map((b) => b.branchId)).toEqual([
      'branch-1',
    ]);
  });

  it("counts a legacy row keyed by the branch's sync2booksBranchId alias, under the canonical id", async () => {
    const { service } = makeService({
      items: [catalogItem('old'), catalogItem('split')],
      branchIds: ['branch-1'],
      aliases: { 'branch-1': '00' },
      allStock: [
        stockRow('old', '00', 118),
        // Same branch, split across both key forms: one branch, one entry.
        stockRow('split', '00', 10),
        stockRow('split', 'branch-1', 5),
      ],
    });

    const { items } = await service.listItems(TENANT_ID);

    const old = items.find((i) => i.id === 'old')!;
    expect(old.stock.total).toBe(118);
    expect(old.stock.branches.map((b) => b.branchId)).toEqual(['branch-1']);
    const split = items.find((i) => i.id === 'split')!;
    expect(split.stock.total).toBe(15);
    expect(split.stock.branches).toEqual([
      { branchId: 'branch-1', quantityOnHand: 15, reservedQuantity: 0 },
    ]);
  });

  it("does not resolve another business's '00' alias to this tenant's branch", async () => {
    const { service } = makeService({
      items: [catalogItem('a')],
      branchIds: ['branch-1'], // no alias of its own
      allStock: [stockRow('a', '00', 99), stockRow('a', 'branch-1', 4)],
    });

    const { items } = await service.listItems(TENANT_ID);

    expect(items[0].stock.total).toBe(4);
  });

  it('skips the stock read entirely for an empty catalogue', async () => {
    const { service, inventory } = makeService({ items: [], allStock: [] });

    const { items } = await service.listItems(TENANT_ID);

    expect(items).toEqual([]);
    expect(inventory.listStockForItems).not.toHaveBeenCalled();
  });
});

describe('DashboardItemsApplicationService.withStock', () => {
  it('embeds stock on an item just returned from a mutation', async () => {
    const { service } = makeService({
      items: [],
      allStock: [stockRow('a', 'branch-1', 8)],
    });

    const [item] = await service.withStock(TENANT_ID, [catalogItem('a')]);

    expect(item.stock).toEqual({
      total: 8,
      branches: [
        { branchId: 'branch-1', quantityOnHand: 8, reservedQuantity: 0 },
      ],
    });
  });

  it("applies the same branch scoping as the list, so an edited row can't regain foreign stock", async () => {
    const { service } = makeService({
      items: [],
      branchIds: ['branch-1'],
      allStock: [
        stockRow('a', 'branch-1', 8),
        stockRow('a', 'other-tenants-branch', 71),
      ],
    });

    const [item] = await service.withStock(TENANT_ID, [catalogItem('a')]);

    expect(item.stock.total).toBe(8);
  });
});
