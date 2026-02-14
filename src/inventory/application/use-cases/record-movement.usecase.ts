import { MovementType } from '../../domain/enums/movement-type.enum';
import type { StockMovement } from '../../domain/entities/stock-movement.entity';
import type { InventoryStock } from '../../domain/entities/inventory-stock.entity';
import type {
  IStockMovementRepository,
  IStockRepository,
} from '../../domain/ports/stock-repository.port';

export interface RecordMovementInput {
  itemId: string;
  branchId: string;
  movementType: MovementType;
  quantity: number;
  referenceType?: string | null;
  referenceId?: string | null;
}

export interface RecordMovementResult {
  movement: StockMovement;
  stock: InventoryStock;
}

/** Sign convention per 05-inventory-and-multi-branch-spec */
function getSignedQuantity(
  movementType: MovementType,
  quantity: number,
): number {
  const outbound: MovementType[] = [
    MovementType.SALE,
    MovementType.TRANSFER_OUT,
  ];
  if (outbound.includes(movementType)) return -Math.abs(quantity);
  if (movementType === MovementType.ADJUSTMENT) return quantity; // Allow +/- directly
  return Math.abs(quantity); // PURCHASE, TRANSFER_IN, RETURN
}

/**
 * Record stock movement.
 * Stock must only change through StockMovement. Atomic update.
 */
export async function recordMovement(
  input: RecordMovementInput,
  stockRepo: IStockRepository,
  movementRepo: IStockMovementRepository,
): Promise<RecordMovementResult> {
  const delta = getSignedQuantity(input.movementType, input.quantity);
  const now = new Date();

  const movement: StockMovement = {
    id: `mov-${input.itemId}-${input.branchId}-${now.getTime()}`,
    itemId: input.itemId,
    branchId: input.branchId,
    movementType: input.movementType,
    quantity: delta,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    createdAt: now,
  };
  await movementRepo.append(movement);

  const stock = await stockRepo.getStock(input.itemId, input.branchId);
  const newQty = (stock?.quantityOnHand ?? 0) + delta;

  if (newQty < 0) {
    throw new Error(
      `Insufficient stock: ${input.itemId} at ${input.branchId}. ` +
        `Have ${stock?.quantityOnHand ?? 0}, tried to deduct ${Math.abs(delta)}`,
    );
  }

  const updatedStock: InventoryStock = {
    itemId: input.itemId,
    branchId: input.branchId,
    quantityOnHand: newQty,
    reservedQuantity: stock?.reservedQuantity ?? 0,
    lastMovementAt: now,
    updatedAt: now,
  };
  await stockRepo.upsertStock(updatedStock);

  return { movement, stock: updatedStock };
}
