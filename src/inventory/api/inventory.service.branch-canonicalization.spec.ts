import { InventoryService } from './inventory.service';
import {
  StockMovementRepositoryStub,
  StockRepositoryStub,
} from '../infrastructure/stock-repository.stub';
import type { IComplianceItemRepository } from '../../shared/ports/repository.port';
import type { ComplianceItem } from '../../shared/domain/entities/compliance-item.entity';
import { MovementType } from '../domain/enums/movement-type.enum';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';

/**
 * Regression coverage for InventoryService.toCanonicalBranchId -- the single
 * choke point that normalizes every stock/movement write onto the canonical
 * branch id (`ComplianceBranch.id`), fixing the bug where Mode A's
 * `sync2booksBranchId` (e.g. '00') and Mode B's `branch.id` produced two
 * `inventory_stock` rows for one logical item+branch, and
 * syncStockMasterToEtims reported whichever one the caller's branch id
 * happened to resolve to as KRA's rsdQty.
 */
describe('InventoryService branch-id canonicalization', () => {
  function makeItem(id: string, merchantId: string): ComplianceItem {
    return {
      id,
      merchantId,
      name: 'Widget',
      sku: 'SKU-1',
      taxCategory: TaxCategory.VAT_STANDARD,
      classificationCode: '14111400',
      unitCode: 'U',
      packagingUnitCode: 'NT',
      taxTyCd: 'B',
      productTypeCode: '2',
      etimsItemCode: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ComplianceItem;
  }

  function buildService(deps: {
    item: ComplianceItem;
    /** Simulates ComplianceOrganizationApplicationService.resolveCanonicalBranchIdForMerchant. */
    resolveCanonicalBranchIdForMerchant?: (
      merchantId: string,
      branchId: string,
    ) => Promise<string | null>;
  }) {
    const itemRepo: IComplianceItemRepository = {
      findByIds: () => Promise.resolve<ComplianceItem[]>([deps.item]),
    };
    const organization = deps.resolveCanonicalBranchIdForMerchant
      ? {
          resolveCanonicalBranchIdForMerchant:
            deps.resolveCanonicalBranchIdForMerchant,
        }
      : undefined;

    // Constructed directly (as inventory.service.spec.ts's sarNo suite
    // already does) rather than through Nest's TestingModule: organization
    // is the 7th, @Optional constructor arg, easiest to hand in as a plain
    // fake here.
    const service = new (InventoryService as any)(
      new StockRepositoryStub(),
      new StockMovementRepositoryStub(),
      itemRepo,
      undefined, // connectionRepo -- unused with ETIMS_STOCK_SYNC unset
      undefined, // etimsAdapter
      undefined, // syncStateRepo
      organization,
    ) as InventoryService;

    return { service };
  }

  it('recordMovement writes to the canonical branch row when called with the sync2books alias', async () => {
    const item = makeItem('item-canon-1', 'merchant-1');
    const canonicalBranchId = 'branch-uuid-1';
    const { service } = buildService({
      item,
      resolveCanonicalBranchIdForMerchant: async (merchantId, branchId) =>
        merchantId === 'merchant-1' && branchId === '00'
          ? canonicalBranchId
          : null,
    });

    const result = await service.recordMovement({
      itemId: item.id,
      branchId: '00',
      movementType: MovementType.PURCHASE,
      quantity: 10,
      referenceType: 'SEED',
      referenceId: 'seed-1',
    });

    expect(result.stock.branchId).toBe(canonicalBranchId);
    expect(await service.listStock(canonicalBranchId)).toEqual([
      expect.objectContaining({ itemId: item.id, quantityOnHand: 10 }),
    ]);
    // No row should exist under the raw alias -- that's the two-rows bug.
    expect(
      (await service.listStock('00')).filter((s) => s.itemId === item.id),
    ).toHaveLength(0);
  });

  it('reconcileStock diffs against the canonical row, not a fresh alias-keyed one', async () => {
    const item = makeItem('item-canon-2', 'merchant-1');
    const canonicalBranchId = 'branch-uuid-2';
    const { service } = buildService({
      item,
      resolveCanonicalBranchIdForMerchant: async () => canonicalBranchId,
    });

    // Existing stock of 20 recorded under the canonical id (e.g. by a prior
    // Mode B write).
    await service.recordMovement({
      itemId: item.id,
      branchId: canonicalBranchId,
      movementType: MovementType.PURCHASE,
      quantity: 20,
      referenceType: 'SEED',
      referenceId: 'seed-1',
    });

    // A Mode A caller reconciles against the alias id '00' with an ERP
    // qtyOnHand of 25 -- the delta must be computed against the existing 20
    // (a delta of +5), not against a nonexistent alias row (which would wrongly
    // apply a delta of +25 and double-count).
    const result = await service.reconcileStock({
      itemId: item.id,
      branchId: '00',
      externalQtyOnHand: 25,
    });

    expect(result.movement.quantity).toBe(5);
    expect(result.stock.quantityOnHand).toBe(25);
    expect(result.stock.branchId).toBe(canonicalBranchId);
  });

  it('falls through unchanged when canonicalization cannot resolve anything (unprovisioned tenant)', async () => {
    const item = makeItem('item-canon-3', 'merchant-unprovisioned');
    const { service } = buildService({
      item,
      resolveCanonicalBranchIdForMerchant: async () => null,
    });

    const result = await service.recordMovement({
      itemId: item.id,
      branchId: 'some-branch',
      movementType: MovementType.PURCHASE,
      quantity: 5,
      referenceType: 'SEED',
      referenceId: 'seed-1',
    });

    expect(result.stock.branchId).toBe('some-branch');
  });

  it('falls through unchanged when canonicalization throws, without failing the write', async () => {
    const item = makeItem('item-canon-4', 'merchant-1');
    const { service } = buildService({
      item,
      resolveCanonicalBranchIdForMerchant: async () => {
        throw new Error('DB unavailable');
      },
    });

    const result = await service.recordMovement({
      itemId: item.id,
      branchId: 'branch-x',
      movementType: MovementType.PURCHASE,
      quantity: 5,
      referenceType: 'SEED',
      referenceId: 'seed-1',
    });

    expect(result.stock.branchId).toBe('branch-x');
  });

  it('passes the branch id through unchanged when no organization service is wired (e.g. plain unit specs)', async () => {
    const item = makeItem('item-canon-5', 'merchant-1');
    const { service } = buildService({ item });

    const result = await service.recordMovement({
      itemId: item.id,
      branchId: 'branch-y',
      movementType: MovementType.PURCHASE,
      quantity: 5,
      referenceType: 'SEED',
      referenceId: 'seed-1',
    });

    expect(result.stock.branchId).toBe('branch-y');
  });
});

/**
 * Regression coverage for InventoryService.requireBranchInItemTenant. A
 * dashboard whose cached branch list still belonged to another business sent
 * that business's branch id with an item from this one: the write landed a
 * stock row (and movements) on a branch of the wrong tenant, and the item's own
 * tenant found no eTIMS connection for it, so nothing ever reached KRA.
 */
describe('InventoryService strict branch check (adjust / transfer / repair)', () => {
  const MERCHANT = 'merchant-1';
  const OWN_BRANCH = 'branch-own';
  const FOREIGN_BRANCH = 'branch-of-another-business';

  function makeItem(id: string): ComplianceItem {
    return {
      id,
      merchantId: MERCHANT,
      name: 'Widget',
      sku: 'SKU-1',
      taxCategory: TaxCategory.VAT_STANDARD,
      classificationCode: '14111400',
      unitCode: 'U',
      packagingUnitCode: 'NT',
      taxTyCd: 'B',
      productTypeCode: '2',
      etimsItemCode: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ComplianceItem;
  }

  // The stock repository stub keeps module-level state across tests, so each
  // test needs an item id of its own.
  let itemSeq = 0;

  function buildService(opts: { tenantProvisioned?: boolean } = {}) {
    const { tenantProvisioned = true } = opts;
    const item = makeItem(`item-strict-${++itemSeq}`);
    const itemRepo: IComplianceItemRepository = {
      findByIds: () => Promise.resolve<ComplianceItem[]>([item]),
    };
    const organization = {
      getTenantByMerchantId: async (merchantId: string) =>
        tenantProvisioned && merchantId === MERCHANT
          ? { id: 'tenant-1' }
          : null,
      // Only OWN_BRANCH (or its '00' alias) exists under tenant-1.
      resolveCanonicalBranchId: async (tenantId: string, branchId: string) =>
        tenantId === 'tenant-1' &&
        (branchId === OWN_BRANCH || branchId === '00')
          ? OWN_BRANCH
          : null,
      resolveCanonicalBranchIdForMerchant: async (
        merchantId: string,
        branchId: string,
      ) =>
        merchantId === MERCHANT &&
        (branchId === OWN_BRANCH || branchId === '00')
          ? OWN_BRANCH
          : null,
    };
    const service = new (InventoryService as any)(
      new StockRepositoryStub(),
      new StockMovementRepositoryStub(),
      itemRepo,
      undefined,
      undefined,
      undefined,
      organization,
    ) as InventoryService;
    return { service, item };
  }

  it('adjustStock refuses a branch that belongs to another business, and writes nothing', async () => {
    const { service, item } = buildService();

    await expect(
      service.adjustStock({
        itemId: item.id,
        branchId: FOREIGN_BRANCH,
        quantity: 70,
        action: 'ADD',
      }),
    ).rejects.toThrow(/does not belong to the business/);

    expect(
      (await service.listStock(FOREIGN_BRANCH)).filter(
        (s) => s.itemId === item.id,
      ),
    ).toHaveLength(0);
    expect(await service.listMovements({ itemId: item.id })).toHaveLength(0);
  });

  it('adjustStock accepts the alias and writes to the canonical branch', async () => {
    const { service, item } = buildService();

    const result = await service.adjustStock({
      itemId: item.id,
      branchId: '00',
      quantity: 5,
      action: 'ADD',
    });

    expect(result.stock.branchId).toBe(OWN_BRANCH);
    expect(result.stock.quantityOnHand).toBe(5);
  });

  it('transferStock refuses a foreign destination before debiting the source', async () => {
    const { service, item } = buildService();
    await service.adjustStock({
      itemId: item.id,
      branchId: OWN_BRANCH,
      quantity: 10,
      action: 'ADD',
    });

    await expect(
      service.transferStock({
        itemId: item.id,
        fromBranchId: OWN_BRANCH,
        receivingItemId: item.id,
        toBranchId: FOREIGN_BRANCH,
        quantity: 4,
      }),
    ).rejects.toThrow(/does not belong to the business/);

    // Source untouched: a half-applied transfer would have left 6 here.
    expect(
      (await service.getStockLevel(item.id, OWN_BRANCH)).quantityOnHand,
    ).toBe(10);
  });

  it('repairKraStockLedger refuses a foreign branch', async () => {
    const { service, item } = buildService();

    await expect(
      service.repairKraStockLedger({
        itemId: item.id,
        branchId: FOREIGN_BRANCH,
      }),
    ).rejects.toThrow(/does not belong to the business/);
  });

  it("stays tolerant when the item's tenant is not provisioned in compliance-api", async () => {
    const { service, item } = buildService({ tenantProvisioned: false });

    const result = await service.adjustStock({
      itemId: item.id,
      branchId: 'whatever-branch',
      quantity: 3,
      action: 'ADD',
    });

    expect(result.stock.branchId).toBe('whatever-branch');
  });
});
