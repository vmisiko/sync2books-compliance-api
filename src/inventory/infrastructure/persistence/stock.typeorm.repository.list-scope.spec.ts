import { StockTypeOrmRepository } from './stock.typeorm.repository';

/**
 * The `itemIds` scope on movement reads. `stock_movements` has no merchantId,
 * so this list is the only thing keeping a tenant-facing read to that
 * tenant's items -- an empty or non-matching scope must return nothing, never
 * fall through to an unfiltered query.
 */
describe('StockTypeOrmRepository.list itemIds scope', () => {
  function row(id: string, itemId: string, at: number) {
    return {
      id,
      itemId,
      branchId: 'b1',
      movementType: 'ADJUSTMENT',
      quantity: 1,
      balanceAfter: 1,
      referenceType: null,
      referenceId: null,
      sourceSystem: null,
      createdAt: new Date(at),
    };
  }

  function build(find: jest.Mock) {
    return new StockTypeOrmRepository({} as never, {} as never, {
      find,
    } as never);
  }

  it('returns nothing for an empty scope without querying', async () => {
    const find = jest.fn();

    await expect(build(find).list({ itemIds: [] })).resolves.toEqual([]);

    expect(find).not.toHaveBeenCalled();
  });

  it('returns nothing when itemId is outside the scope, without querying', async () => {
    const find = jest.fn();

    await expect(
      build(find).list({ itemIds: ['mine'], itemId: 'theirs' }),
    ).resolves.toEqual([]);

    expect(find).not.toHaveBeenCalled();
  });

  it('merges chunks newest-first and applies the limit across them', async () => {
    const ids = Array.from({ length: 600 }, (_, i) => `item-${i}`);
    const find = jest
      .fn()
      .mockResolvedValueOnce([row('m1', 'item-1', 100), row('m2', 'item-2', 300)])
      .mockResolvedValueOnce([row('m3', 'item-550', 200)]);

    const result = await build(find).list({ itemIds: ids, limit: 2 });

    expect(find).toHaveBeenCalledTimes(2);
    expect(result.map((m) => m.id)).toEqual(['m2', 'm3']);
  });
});
