import type { InventoryStock } from '../domain/entities/inventory-stock.entity';
import type { StockMovement } from '../domain/entities/stock-movement.entity';
import type {
  IStockMovementRepository,
  IStockRepository,
} from '../domain/ports/stock-repository.port';
import { InsufficientStockError } from '../domain/errors/insufficient-stock.error';

const stockByKey = new Map<string, InventoryStock>();
const movements: StockMovement[] = [];

function stockKey(itemId: string, branchId: string): string {
  return `${itemId}:${branchId}`;
}

export class StockRepositoryStub implements IStockRepository {
  getStock(itemId: string, branchId: string): Promise<InventoryStock | null> {
    return Promise.resolve(stockByKey.get(stockKey(itemId, branchId)) ?? null);
  }

  applyDelta(
    itemId: string,
    branchId: string,
    delta: number,
  ): Promise<InventoryStock> {
    const key = stockKey(itemId, branchId);
    const current = stockByKey.get(key);
    const currentQty = current?.quantityOnHand ?? 0;
    const newQty = currentQty + delta;
    if (newQty < 0) {
      return Promise.reject(
        new InsufficientStockError(
          `Insufficient stock: ${itemId} at ${branchId}. Have ${currentQty}, tried to apply ${delta}`,
        ),
      );
    }
    const now = new Date();
    const updated: InventoryStock = {
      itemId,
      branchId,
      quantityOnHand: newQty,
      reservedQuantity: current?.reservedQuantity ?? 0,
      lastMovementAt: now,
      updatedAt: now,
    };
    stockByKey.set(key, updated);
    return Promise.resolve(updated);
  }

  listByBranch(branchId?: string): Promise<InventoryStock[]> {
    const all = Array.from(stockByKey.values());
    return Promise.resolve(
      branchId ? all.filter((s) => s.branchId === branchId) : all,
    );
  }
}

export class StockMovementRepositoryStub implements IStockMovementRepository {
  append(movement: StockMovement): Promise<StockMovement> {
    movements.push({ ...movement });
    return Promise.resolve(movement);
  }

  list(params: {
    itemId?: string;
    branchId?: string;
    limit?: number;
  }): Promise<StockMovement[]> {
    let result = movements.slice().reverse();
    if (params.itemId) result = result.filter((m) => m.itemId === params.itemId);
    if (params.branchId)
      result = result.filter((m) => m.branchId === params.branchId);
    if (params.limit) result = result.slice(0, params.limit);
    return Promise.resolve(result);
  }
}
