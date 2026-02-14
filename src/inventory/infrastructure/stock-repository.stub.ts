import type { InventoryStock } from '../domain/entities/inventory-stock.entity';
import type { StockMovement } from '../domain/entities/stock-movement.entity';
import type {
  IStockMovementRepository,
  IStockRepository,
} from '../domain/ports/stock-repository.port';

const stockByKey = new Map<string, InventoryStock>();
const movements: StockMovement[] = [];

function stockKey(itemId: string, branchId: string): string {
  return `${itemId}:${branchId}`;
}

export class StockRepositoryStub implements IStockRepository {
  async getStock(
    itemId: string,
    branchId: string,
  ): Promise<InventoryStock | null> {
    return stockByKey.get(stockKey(itemId, branchId)) ?? null;
  }

  async upsertStock(stock: InventoryStock): Promise<InventoryStock> {
    stockByKey.set(stockKey(stock.itemId, stock.branchId), { ...stock });
    return stock;
  }
}

export class StockMovementRepositoryStub implements IStockMovementRepository {
  async append(movement: StockMovement): Promise<StockMovement> {
    movements.push({ ...movement });
    return movement;
  }
}
