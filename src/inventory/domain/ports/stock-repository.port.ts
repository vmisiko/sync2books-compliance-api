import type { InventoryStock } from '../entities/inventory-stock.entity';
import type { StockMovement } from '../entities/stock-movement.entity';

export interface IStockRepository {
  getStock(itemId: string, branchId: string): Promise<InventoryStock | null>;
  /**
   * Atomically applies a signed delta to quantityOnHand (creating the row at 0
   * if absent). Throws InsufficientStockError if the resulting quantity would
   * go negative -- this is the only way stock levels change, per
   * 05-inventory-and-multi-branch-spec.md's concurrency guard.
   */
  applyDelta(
    itemId: string,
    branchId: string,
    delta: number,
  ): Promise<InventoryStock>;
  listByBranch(branchId?: string): Promise<InventoryStock[]>;
  /** Every stock row for one item, under whatever branch ids it's keyed by. */
  listByItem(itemId: string): Promise<InventoryStock[]>;
  /**
   * Stock rows for a set of items in one read -- the batched form of
   * listByItem, for a caller that already holds a tenant's item ids (the
   * Item Sync list). inventory_stock carries no merchantId, so tenant scope
   * comes entirely from the ids the caller passes: never pass ids that were
   * not read through a merchant-scoped query.
   */
  listByItems(itemIds: string[]): Promise<InventoryStock[]>;
}

export interface IStockMovementRepository {
  append(movement: StockMovement): Promise<StockMovement>;
  /**
   * `stock_movements` carries no merchantId, so a tenant-facing caller scopes
   * the read with `itemIds` -- the ids it already resolved through a
   * merchant-scoped query. When set, only movements of those items are
   * returned, and an empty array returns nothing (it is a scope, not "no
   * filter"). Omit `itemIds` only for callers that are not acting for a tenant.
   */
  list(params: {
    itemId?: string;
    itemIds?: string[];
    branchId?: string;
    limit?: number;
  }): Promise<StockMovement[]>;
  /**
   * Every movement already recorded against one source document, so a caller
   * that may run twice for the same document (SalesService.
   * applyInventoryMovements, reached both from the original submit and from a
   * retry of a document still sitting in DRAFT) can tell what it already
   * applied instead of double-counting stock. Unbounded on purpose -- a single
   * document's movement count is bounded by its line count.
   */
  findByReference(
    referenceType: string,
    referenceId: string,
  ): Promise<StockMovement[]>;
}
