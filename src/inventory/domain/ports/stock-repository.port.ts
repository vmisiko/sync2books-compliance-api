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
  applyDelta(itemId: string, branchId: string, delta: number): Promise<InventoryStock>;
  listByBranch(branchId?: string): Promise<InventoryStock[]>;
}

export interface IStockMovementRepository {
  append(movement: StockMovement): Promise<StockMovement>;
  list(params: {
    itemId?: string;
    branchId?: string;
    limit?: number;
  }): Promise<StockMovement[]>;
}
