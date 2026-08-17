import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { InventoryStock } from '../../domain/entities/inventory-stock.entity';
import type { StockMovement } from '../../domain/entities/stock-movement.entity';
import type { MovementType } from '../../domain/enums/movement-type.enum';
import type {
  IStockMovementRepository,
  IStockRepository,
} from '../../domain/ports/stock-repository.port';
import { InsufficientStockError } from '../../domain/errors/insufficient-stock.error';
import { InventoryStockOrmEntity } from './inventory-stock.orm-entity';
import { StockMovementOrmEntity } from './stock-movement.orm-entity';

function stockId(itemId: string, branchId: string): string {
  return `${itemId}:${branchId}`;
}

function toDomainStock(e: InventoryStockOrmEntity): InventoryStock {
  return {
    itemId: e.itemId,
    branchId: e.branchId,
    quantityOnHand: e.quantityOnHand,
    reservedQuantity: e.reservedQuantity,
    lastMovementAt: e.lastMovementAt ?? e.updatedAt,
    updatedAt: e.updatedAt,
  };
}

function toDomainMovement(e: StockMovementOrmEntity): StockMovement {
  return {
    id: e.id,
    itemId: e.itemId,
    branchId: e.branchId,
    movementType: e.movementType as MovementType,
    quantity: e.quantity,
    balanceAfter: e.balanceAfter,
    referenceType: e.referenceType,
    referenceId: e.referenceId,
    sourceSystem: e.sourceSystem,
    createdAt: e.createdAt,
  };
}

@Injectable()
export class StockTypeOrmRepository
  implements IStockRepository, IStockMovementRepository
{
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(InventoryStockOrmEntity)
    private readonly stockRepo: Repository<InventoryStockOrmEntity>,
    @InjectRepository(StockMovementOrmEntity)
    private readonly movementRepo: Repository<StockMovementOrmEntity>,
  ) {}

  async getStock(
    itemId: string,
    branchId: string,
  ): Promise<InventoryStock | null> {
    const row = await this.stockRepo.findOne({
      where: { id: stockId(itemId, branchId) },
    });
    return row ? toDomainStock(row) : null;
  }

  /**
   * Locks the row for the duration of the transaction (SELECT ... FOR UPDATE)
   * so two concurrent movements on the same item+branch serialize rather than
   * racing a read-then-write. Known gap: two *concurrent first-ever* writes
   * for a brand-new item+branch pair could both see no row and both attempt
   * to insert, since there's nothing yet to lock -- the table's unique
   * (itemId, branchId) constraint prevents silent corruption (one insert
   * fails), but that failure isn't retried here. Accepted for this pass since
   * it only affects the single moment a pair is first created.
   */
  async applyDelta(
    itemId: string,
    branchId: string,
    delta: number,
  ): Promise<InventoryStock> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(InventoryStockOrmEntity);
      const id = stockId(itemId, branchId);
      const existing = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      const currentQty = existing?.quantityOnHand ?? 0;
      const newQty = currentQty + delta;
      if (newQty < 0) {
        throw new InsufficientStockError(
          `Insufficient stock: ${itemId} at ${branchId}. Have ${currentQty}, tried to apply ${delta}`,
        );
      }
      const now = new Date();
      const toSave = existing
        ? { ...existing, quantityOnHand: newQty, version: existing.version + 1, lastMovementAt: now }
        : repo.create({
            id,
            itemId,
            branchId,
            quantityOnHand: newQty,
            reservedQuantity: 0,
            version: 1,
            lastMovementAt: now,
          });
      const saved = await repo.save(toSave);
      return toDomainStock(saved);
    });
  }

  async listByBranch(branchId?: string): Promise<InventoryStock[]> {
    const rows = await this.stockRepo.find(
      branchId ? { where: { branchId } } : {},
    );
    return rows.map(toDomainStock);
  }

  async append(movement: StockMovement): Promise<StockMovement> {
    const row = this.movementRepo.create({
      id: movement.id,
      itemId: movement.itemId,
      branchId: movement.branchId,
      movementType: movement.movementType,
      quantity: movement.quantity,
      balanceAfter: movement.balanceAfter,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      sourceSystem: movement.sourceSystem,
      createdAt: movement.createdAt,
    });
    await this.movementRepo.save(row);
    return movement;
  }

  async list(params: {
    itemId?: string;
    branchId?: string;
    limit?: number;
  }): Promise<StockMovement[]> {
    const where: { itemId?: string; branchId?: string } = {};
    if (params.itemId) where.itemId = params.itemId;
    if (params.branchId) where.branchId = params.branchId;
    const rows = await this.movementRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: params.limit ?? 100,
    });
    return rows.map(toDomainMovement);
  }
}
