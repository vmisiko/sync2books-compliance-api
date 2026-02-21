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
  getStock(itemId: string, branchId: string): Promise<InventoryStock | null> {
    return Promise.resolve(stockByKey.get(stockKey(itemId, branchId)) ?? null);
  }

  upsertStock(stock: InventoryStock): Promise<InventoryStock> {
    stockByKey.set(stockKey(stock.itemId, stock.branchId), { ...stock });
    return Promise.resolve(stock);
  }
}

export class StockMovementRepositoryStub implements IStockMovementRepository {
  append(movement: StockMovement): Promise<StockMovement> {
    movements.push({ ...movement });
    return Promise.resolve(movement);
  }
}
