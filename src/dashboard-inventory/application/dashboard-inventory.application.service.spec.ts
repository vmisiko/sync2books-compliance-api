import { NotFoundException } from '@nestjs/common';
import { DashboardInventoryApplicationService } from './dashboard-inventory.application.service';

/**
 * The item ids on adjust/transfer/repair-ledger come from the request body, so
 * the active business (`x-tenant-id`) has to be checked against the item's
 * owner -- otherwise a caller could act on another business's item.
 */
describe('DashboardInventoryApplicationService item ownership', () => {
  const TENANT = {
    id: 'tenant-1',
    sync2booksCompanyId: 'company-1',
  };

  function build(item: { id: string; merchantId: string } | null) {
    const inventory = {
      adjustStock: jest.fn().mockResolvedValue({ ok: true }),
      transferStock: jest.fn().mockResolvedValue({ ok: true }),
      repairKraStockLedger: jest.fn().mockResolvedValue({ ok: true }),
    };
    const organization = {
      getTenantById: jest.fn(async (id: string) =>
        id === TENANT.id ? TENANT : null,
      ),
    };
    const catalog = { getItemById: jest.fn().mockResolvedValue(item) };
    const service = new DashboardInventoryApplicationService(
      inventory as never,
      organization as never,
      catalog as never,
      {} as never,
      {} as never,
    );
    return { service, inventory };
  }

  const adjustInput = {
    itemId: 'item-1',
    branchId: 'branch-1',
    quantity: 5,
    action: 'ADD' as const,
  };

  it("adjusts an item that belongs to the active business's company", async () => {
    const { service, inventory } = build({
      id: 'item-1',
      merchantId: 'company-1',
    });

    await service.adjust(TENANT.id, adjustInput);

    expect(inventory.adjustStock).toHaveBeenCalledWith(adjustInput);
  });

  it("falls back to the tenant's own id as merchantId for a compliance-only business", async () => {
    const { service, inventory } = build({
      id: 'item-1',
      merchantId: 'tenant-1',
    });
    // Same tenant, but with no main-API company link.
    (service as any).organization.getTenantById = jest.fn(async () => ({
      id: 'tenant-1',
      sync2booksCompanyId: null,
    }));

    await service.adjust(TENANT.id, adjustInput);

    expect(inventory.adjustStock).toHaveBeenCalled();
  });

  it.each([
    [
      'adjust',
      (s: DashboardInventoryApplicationService) =>
        s.adjust(TENANT.id, adjustInput),
    ],
    [
      'transfer',
      (s: DashboardInventoryApplicationService) =>
        s.transfer(TENANT.id, {
          itemId: 'item-1',
          fromBranchId: 'a',
          toBranchId: 'b',
          quantity: 1,
        }),
    ],
    [
      'repairKraLedger',
      (s: DashboardInventoryApplicationService) =>
        s.repairKraLedger(TENANT.id, { itemId: 'item-1', branchId: 'a' }),
    ],
  ])(
    '%s refuses an item owned by another business, without touching stock',
    async (_name, call) => {
      const { service, inventory } = build({
        id: 'item-1',
        merchantId: 'someone-elses-company',
      });

      await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);

      expect(inventory.adjustStock).not.toHaveBeenCalled();
      expect(inventory.transferStock).not.toHaveBeenCalled();
      expect(inventory.repairKraStockLedger).not.toHaveBeenCalled();
    },
  );

  it('answers "not found" for an item id that does not exist', async () => {
    const { service } = build(null);

    await expect(service.adjust(TENANT.id, adjustInput)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
