import type { InventoryStock } from '../entities/inventory-stock.entity';
import type { StockMovement } from '../entities/stock-movement.entity';

export interface IStockRepository {
  getStock(itemId: string, branchId: string): Promise<InventoryStock | null>;
  upsertStock(stock: InventoryStock): Promise<InventoryStock>;
}

export interface IStockMovementRepository {
  append(movement: StockMovement): Promise<StockMovement>;
}
