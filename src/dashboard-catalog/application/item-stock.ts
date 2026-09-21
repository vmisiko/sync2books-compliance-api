import type { CatalogItem } from '../../catalog/domain/entities/catalog-item.entity';
import type { InventoryStock } from '../../inventory/domain/entities/inventory-stock.entity';

/** One branch's slice of an item's stock, as the Item Sync page needs it. */
export interface ItemBranchStock {
  branchId: string;
  quantityOnHand: number;
  reservedQuantity: number;
}

/**
 * An item's stock, embedded in the items list so the dashboard doesn't have
 * to fetch and join `inventory_stock` itself.
 *
 * `branches` is the source of truth and `total` is only its sum. Both ship
 * because a quantity edit must diff against ONE branch's row, never the
 * total: KRA's rsdQty is per-bhfId, so diffing a two-branch item's total
 * against a single branch writes a wrong quantity to KRA's stock master.
 * `total` is for display; anything that writes goes through `branches`.
 */
export interface ItemStockSummary {
  total: number;
  branches: ItemBranchStock[];
}

export type CatalogItemWithStock = CatalogItem & { stock: ItemStockSummary };

const EMPTY_STOCK: ItemStockSummary = { total: 0, branches: [] };

/**
 * Attaches each item's stock rows. An item with no row gets zero rather than
 * an absent field -- "no row yet" and "empty" mean the same thing to the
 * page, and a required field means the client never has to guard for either.
 *
 * Pure: `rows` must already be limited to `items`' ids by the caller, since
 * that id list is the only tenant boundary inventory_stock has.
 */
export function attachStock(
  items: CatalogItem[],
  rows: InventoryStock[],
): CatalogItemWithStock[] {
  const byItem = new Map<string, ItemBranchStock[]>();
  for (const row of rows) {
    const branches = byItem.get(row.itemId) ?? [];
    branches.push({
      branchId: row.branchId,
      quantityOnHand: row.quantityOnHand,
      reservedQuantity: row.reservedQuantity,
    });
    byItem.set(row.itemId, branches);
  }

  return items.map((item) => {
    const branches = byItem.get(item.id);
    if (!branches) return { ...item, stock: { ...EMPTY_STOCK, branches: [] } };
    return {
      ...item,
      stock: {
        total: branches.reduce((sum, b) => sum + b.quantityOnHand, 0),
        branches,
      },
    };
  });
}
