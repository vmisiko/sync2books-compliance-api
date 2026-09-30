import type { CatalogItem } from '../../catalog/domain/entities/catalog-item.entity';
import type { InventoryStock } from '../../inventory/domain/entities/inventory-stock.entity';
import { attachStock } from './item-stock';

function item(id: string): CatalogItem {
  return { id, merchantId: 'merchant-1', name: id } as CatalogItem;
}

function row(
  itemId: string,
  branchId: string,
  quantityOnHand: number,
  reservedQuantity = 0,
): InventoryStock {
  const now = new Date();
  return {
    itemId,
    branchId,
    quantityOnHand,
    reservedQuantity,
    lastMovementAt: now,
    updatedAt: now,
  };
}

describe('attachStock', () => {
  it('sums a multi-branch item into total and keeps each branch row', () => {
    const [result] = attachStock(
      [item('a')],
      [row('a', 'branch-1', 5, 1), row('a', 'branch-2', 7)],
    );

    expect(result.stock.total).toBe(12);
    expect(result.stock.branches).toEqual([
      { branchId: 'branch-1', quantityOnHand: 5, reservedQuantity: 1 },
      { branchId: 'branch-2', quantityOnHand: 7, reservedQuantity: 0 },
    ]);
  });

  it('gives an item with no stock row zero, never an absent field', () => {
    const [result] = attachStock([item('a')], []);

    expect(result.stock).toEqual({ total: 0, branches: [] });
  });

  it('does not share the empty branches array between items', () => {
    const [a, b] = attachStock([item('a'), item('b')], []);

    a.stock.branches.push({
      branchId: 'x',
      quantityOnHand: 1,
      reservedQuantity: 0,
    });

    expect(b.stock.branches).toEqual([]);
  });

  it('ignores stock rows for items that were not passed in', () => {
    const results = attachStock([item('a')], [row('other', 'branch-1', 99)]);

    expect(results).toHaveLength(1);
    expect(results[0].stock.total).toBe(0);
  });

  it('keeps the original item fields', () => {
    const [result] = attachStock([item('a')], [row('a', 'branch-1', 3)]);

    expect(result).toMatchObject({ id: 'a', merchantId: 'merchant-1' });
  });
});
