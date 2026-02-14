import { Inject, Injectable } from '@nestjs/common';
import { recordMovement } from '../application/use-cases/record-movement.usecase';
import { getStockLevel } from '../application/use-cases/get-stock-level.usecase';
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

  async getStockLevel(itemId: string, branchId: string) {
    return getStockLevel({ itemId, branchId }, this.stockRepo);
  }
}
