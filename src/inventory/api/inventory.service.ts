import { Inject, Injectable } from '@nestjs/common';
import { recordMovement } from '../application/use-cases/record-movement.usecase';
import type {
  IStockMovementRepository,
  IStockRepository,
} from '../domain/ports/stock-repository.port';
import { MovementType } from '../domain/enums/movement-type.enum';
import { STOCK_MOVEMENT_REPO, STOCK_REPO } from '../../shared/tokens';

@Injectable()
export class InventoryService {
  constructor(
    @Inject(STOCK_REPO)
    private readonly stockRepo: IStockRepository,
    @Inject(STOCK_MOVEMENT_REPO)
    private readonly movementRepo: IStockMovementRepository,
  ) {}

  async recordMovement(params: {
    itemId: string;
    branchId: string;
    movementType: MovementType;
    quantity: number;
    referenceType?: string | null;
    referenceId?: string | null;
  }) {
    return recordMovement(params, this.stockRepo, this.movementRepo);
  }

  async adjustStock(params: {
    itemId: string;
    branchId: string;
    quantity: number;
    action: 'ADD' | 'DEDUCT';
    movementTypeCode?: string;
    referenceId?: string;
  }) {
    const signedQty =
      params.action === 'DEDUCT'
        ? -Math.abs(params.quantity)
        : Math.abs(params.quantity);
    return this.recordMovement({
      itemId: params.itemId,
      branchId: params.branchId,
      movementType: MovementType.ADJUSTMENT,
      quantity: signedQty,
      referenceType: params.movementTypeCode
        ? `MANUAL_ADJUST:${params.movementTypeCode}`
        : 'MANUAL_ADJUST',
      referenceId: params.referenceId ?? null,
    });
  }

  async transferStock(params: {
    itemId: string;
    fromBranchId: string;
    receivingItemId: string;
    toBranchId: string;
    quantity: number;
    referenceId?: string;
  }) {
    const refId = params.referenceId ?? `xfer-${Date.now()}`;
    const out = await this.recordMovement({
      itemId: params.itemId,
      branchId: params.fromBranchId,
      movementType: MovementType.TRANSFER_OUT,
      quantity: params.quantity,
      referenceType: 'TRANSFER',
      referenceId: refId,
    });

    try {
      const into = await this.recordMovement({
        itemId: params.receivingItemId,
        branchId: params.toBranchId,
        movementType: MovementType.TRANSFER_IN,
        quantity: params.quantity,
        referenceType: 'TRANSFER',
        referenceId: refId,
      });
      return { referenceId: refId, from: out.stock, to: into.stock };
    } catch (e) {
      // Best-effort compensation: undo the out movement.
      await this.recordMovement({
        itemId: params.itemId,
        branchId: params.fromBranchId,
        movementType: MovementType.ADJUSTMENT,
        quantity: Math.abs(params.quantity),
        referenceType: 'TRANSFER_COMPENSATE',
        referenceId: refId,
      });
      throw e;
    }
  }
}
