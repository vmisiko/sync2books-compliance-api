import { Logger } from '@nestjs/common';
import { StockTypeOrmRepository } from './stock.typeorm.repository';
import { InventoryStockOrmEntity } from './inventory-stock.orm-entity';

/**
 * Regression coverage for the split-branch-keying recurrence guard
 * (StockTypeOrmRepository.applyDelta -> warnOnSplitBranchKeying), added
 * alongside InventoryService.toCanonicalBranchId to catch a caller that
 * still keys `inventory_stock` by a non-canonical branch id (the root cause
 * of the two-rows-per-branch bug) even after normalization should have
 * prevented it.
 *
 * Built against a fake DataSource/Repository rather than a real TypeORM
 * connection: applyDelta's `SELECT ... FOR UPDATE` pessimistic lock isn't
 * supported by the sqljs driver this repo's other specs use for in-memory DB
 * tests (see inventory.service.spec.ts's sarNo suite for the same
 * limitation), and standing up a real MySQL connection isn't practical here.
 * The fake models exactly the read/create/save shape applyDelta drives.
 */
describe('StockTypeOrmRepository.applyDelta -- split-branch-keying guard', () => {
  function makeFakeStockRepo() {
    const rows = new Map<string, InventoryStockOrmEntity>();
    return {
      rows,
      findOne: async ({ where: { id } }: any) => rows.get(id) ?? null,
      find: async ({ where: { itemId } }: any) =>
        Array.from(rows.values()).filter((r) => r.itemId === itemId),
      create: (partial: Partial<InventoryStockOrmEntity>) =>
        partial as InventoryStockOrmEntity,
      save: async (row: InventoryStockOrmEntity) => {
        rows.set(row.id, row);
        return row;
      },
    };
  }

  function buildRepository(
    fakeStockRepo: ReturnType<typeof makeFakeStockRepo>,
  ) {
    const dataSource = {
      transaction: async (work: (manager: any) => Promise<unknown>) =>
        work({ getRepository: () => fakeStockRepo }),
    };
    return new StockTypeOrmRepository(
      dataSource as any,
      fakeStockRepo as any,
      undefined as any, // movementRepo -- unused by applyDelta
    );
  }

  it('does not warn on the very first stock row for an item', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const repo = buildRepository(makeFakeStockRepo());

    await repo.applyDelta('item-1', 'branch-uuid-1', 10);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not warn again for a second delta against the same existing row', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const fakeStockRepo = makeFakeStockRepo();
    const repo = buildRepository(fakeStockRepo);

    await repo.applyDelta('item-2', 'branch-uuid-1', 10);
    warnSpy.mockClear();
    await repo.applyDelta('item-2', 'branch-uuid-1', 5);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  /**
   * The exact recurrence this guard exists for: an item that already has a
   * stock row for one branch id (e.g. the canonical UUID) gains a *second*
   * row for a different branch id (e.g. the '00' alias) -- must warn loudly
   * rather than silently create the split.
   */
  it('warns when an item gains a stock row for a second, different branch id', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const fakeStockRepo = makeFakeStockRepo();
    const repo = buildRepository(fakeStockRepo);

    await repo.applyDelta('item-3', 'branch-uuid-1', 10);
    warnSpy.mockClear();
    await repo.applyDelta('item-3', '00', 0);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0];
    expect(message).toContain('item-3');
    expect(message).toContain('branch 00');
    expect(message).toContain('branch-uuid-1');
    warnSpy.mockRestore();

    // Still writes the second row -- this is a warn-only guard, not a block
    // (a genuinely multi-branch tenant must not be prevented from getting a
    // second real branch's stock row).
    expect(await repo.getStock('item-3', '00')).not.toBeNull();
    expect(await repo.getStock('item-3', 'branch-uuid-1')).not.toBeNull();
  });
});
