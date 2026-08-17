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
  sourceSystem?: string | null;
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
  // ADJUSTMENT/RECONCILE carry an already-signed delta (can be +/-).
  if (
    movementType === MovementType.ADJUSTMENT ||
    movementType === MovementType.RECONCILE
  )
    return quantity;
  return Math.abs(quantity); // PURCHASE, TRANSFER_IN, RETURN
}

/**
 * Record stock movement.
 * Stock must only change through StockMovement, applied atomically by the
 * repository (IStockRepository.applyDelta) -- it throws InsufficientStockError
 * before anything is recorded, so a rejected movement never lands in the ledger.
 */
export async function recordMovement(
  input: RecordMovementInput,
  stockRepo: IStockRepository,
  movementRepo: IStockMovementRepository,
): Promise<RecordMovementResult> {
  const delta = getSignedQuantity(input.movementType, input.quantity);
  const now = new Date();

  const stock = await stockRepo.applyDelta(input.itemId, input.branchId, delta);

  const movement: StockMovement = {
    id: `mov-${input.itemId}-${input.branchId}-${now.getTime()}`,
    itemId: input.itemId,
    branchId: input.branchId,
    movementType: input.movementType,
    quantity: delta,
    balanceAfter: stock.quantityOnHand,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    sourceSystem: input.sourceSystem ?? null,
    createdAt: now,
  };
  await movementRepo.append(movement);

  return { movement, stock };
}
