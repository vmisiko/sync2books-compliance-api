import { NotFoundException } from '@nestjs/common';
import { InventoryService } from '../../inventory/api/inventory.service';
import { MovementType } from '../../inventory/domain/enums/movement-type.enum';
import {
  StockMovementRepositoryStub,
  StockRepositoryStub,
} from '../../inventory/infrastructure/stock-repository.stub';
import { DashboardInventoryApplicationService } from './dashboard-inventory.application.service';

/**
 * GET stock / GET movements on the dashboard. `inventory_stock` and
 * `stock_movements` carry no merchantId, so before this fix a caller with no
 * `branchId` got every tenant's rows, and one with a foreign `branchId` got
 * that tenant's. Two tenants share the legacy branch key '00' here on purpose:
 * a branch id is not a tenant boundary, only the item ids are.
 */
describe('DashboardInventoryApplicationService stock/movements tenant scope', () => {
  const TENANT_A = { id: 'tenant-a', sync2booksCompanyId: 'company-a' };
  const TENANT_B = { id: 'tenant-b', sync2booksCompanyId: 'company-b' };
  const TENANTS = [TENANT_A, TENANT_B];

  const BRANCHES: Record<string, Array<{ id: string; sync2booksBranchId: string }>> = {
    'tenant-a': [{ id: 'branch-a', sync2booksBranchId: '00' }],
    'tenant-b': [{ id: 'branch-b', sync2booksBranchId: '00' }],
  };

  const ITEMS = [
    { id: 'item-a', merchantId: 'company-a' },
    { id: 'item-b', merchantId: 'company-b' },
  ];

  const stockRepo = new StockRepositoryStub();
  const movementRepo = new StockMovementRepositoryStub();
  const inventory = new InventoryService(stockRepo, movementRepo);

  const organization = {
    getTenantById: jest.fn(
      async (id: string) => TENANTS.find((t) => t.id === id) ?? null,
    ),
    resolveCanonicalBranchId: jest.fn(
      async (tenantId: string, branchId: string) => {
        const branches = BRANCHES[tenantId] ?? [];
        return (
          (
            branches.find((b) => b.id === branchId) ??
            branches.find((b) => b.sync2booksBranchId === branchId)
          )?.id ?? null
        );
      },
    ),
  };
  const catalog = {
    listItemIdsForMerchant: jest.fn(async (merchantId: string) =>
      ITEMS.filter((i) => i.merchantId === merchantId).map((i) => i.id),
    ),
    getItemById: jest.fn(
      async (id: string) => ITEMS.find((i) => i.id === id) ?? null,
    ),
  };

  const service = new DashboardInventoryApplicationService(
    inventory,
    organization as never,
    catalog as never,
    {} as never,
    {} as never,
  );

  async function seedMovement(itemId: string, branchId: string, qty: number) {
    await stockRepo.applyDelta(itemId, branchId, qty);
    await movementRepo.append({
      id: `mv-${itemId}-${branchId}-${qty}`,
      itemId,
      branchId,
      movementType: MovementType.ADJUSTMENT,
      quantity: qty,
      balanceAfter: qty,
      referenceType: null,
      referenceId: null,
      sourceSystem: null,
      createdAt: new Date(),
    });
  }

  beforeAll(async () => {
    // Each tenant has a canonical-keyed row and a legacy '00'-keyed row.
    await seedMovement('item-a', 'branch-a', 5);
    await seedMovement('item-a', '00', 1);
    await seedMovement('item-b', 'branch-b', 7);
    await seedMovement('item-b', '00', 2);
  });

  const itemsOf = (rows: Array<{ itemId: string }>) =>
    Array.from(new Set(rows.map((r) => r.itemId))).sort();

  describe('listStock', () => {
    it("without branchId returns only the caller's rows, never another tenant's", async () => {
      const a = await service.listStock(TENANT_A.id);
      const b = await service.listStock(TENANT_B.id);

      expect(itemsOf(a)).toEqual(['item-a']);
      expect(itemsOf(b)).toEqual(['item-b']);
      expect(a).toHaveLength(2);
      expect(b).toHaveLength(2);
    });

    it("with the caller's own branchId returns only that branch's rows", async () => {
      const rows = await service.listStock(TENANT_A.id, 'branch-a');

      expect(rows).toEqual([
        expect.objectContaining({
          itemId: 'item-a',
          branchId: 'branch-a',
          quantityOnHand: 5,
        }),
      ]);
    });

    it("refuses another tenant's branchId as not found", async () => {
      await expect(
        service.listStock(TENANT_A.id, 'branch-b'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.listStock(TENANT_B.id, 'branch-a'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("keeps the shared legacy '00' key from leaking the other tenant's row", async () => {
      // '00' resolves to each tenant's own branch, but the stock rows keyed
      // '00' belong to both tenants -- only the caller's item may come back.
      const a = await service.listStock(TENANT_A.id, '00');
      const b = await service.listStock(TENANT_B.id, '00');

      expect(a).toEqual([
        expect.objectContaining({ itemId: 'item-a', branchId: '00' }),
      ]);
      expect(b).toEqual([
        expect.objectContaining({ itemId: 'item-b', branchId: '00' }),
      ]);
    });

    it('returns nothing, not everything, for a tenant with no items', async () => {
      catalog.listItemIdsForMerchant.mockResolvedValueOnce([]);

      await expect(service.listStock(TENANT_A.id)).resolves.toEqual([]);
    });

    it('refuses an unknown tenant', async () => {
      await expect(service.listStock('no-such-tenant')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listMovements', () => {
    it("without filters returns only the caller's movements", async () => {
      const a = await service.listMovements(TENANT_A.id, {});
      const b = await service.listMovements(TENANT_B.id, {});

      expect(itemsOf(a)).toEqual(['item-a']);
      expect(itemsOf(b)).toEqual(['item-b']);
      expect(a).toHaveLength(2);
    });

    it("refuses another tenant's itemId as not found", async () => {
      await expect(
        service.listMovements(TENANT_A.id, { itemId: 'item-b' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns the caller's own item's movements when itemId is given", async () => {
      const rows = await service.listMovements(TENANT_A.id, {
        itemId: 'item-a',
      });

      expect(itemsOf(rows)).toEqual(['item-a']);
    });

    it("refuses another tenant's branchId as not found", async () => {
      await expect(
        service.listMovements(TENANT_A.id, { branchId: 'branch-b' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("keeps the shared legacy '00' key from leaking the other tenant's movements", async () => {
      const a = await service.listMovements(TENANT_A.id, { branchId: '00' });

      expect(a).toEqual([
        expect.objectContaining({ itemId: 'item-a', branchId: '00' }),
      ]);
    });

    it('returns nothing, not everything, for a tenant with no items', async () => {
      catalog.listItemIdsForMerchant.mockResolvedValueOnce([]);

      await expect(service.listMovements(TENANT_A.id, {})).resolves.toEqual(
        [],
      );
    });

    it('still honours limit inside the tenant scope', async () => {
      const rows = await service.listMovements(TENANT_A.id, { limit: 1 });

      expect(rows).toHaveLength(1);
      expect(rows[0].itemId).toBe('item-a');
    });
  });
});
