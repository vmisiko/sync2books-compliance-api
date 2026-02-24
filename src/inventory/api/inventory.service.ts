import { Inject, Injectable, Optional } from '@nestjs/common';
import { recordMovement } from '../application/use-cases/record-movement.usecase';
import type {
  IStockMovementRepository,
  IStockRepository,
} from '../domain/ports/stock-repository.port';
import { MovementType } from '../domain/enums/movement-type.enum';
import {
  CONNECTION_REPO,
  ETIMS_ADAPTER,
  ITEM_REPO,
  STOCK_MOVEMENT_REPO,
  STOCK_REPO,
} from '../../shared/tokens';
import type {
  IComplianceConnectionRepository,
  IComplianceItemRepository,
} from '../../shared/ports/repository.port';
import type { IEtimsAdapter } from '../../regulatory/oscu/ports/etims-adapter.port';
import type { ComplianceItem } from '../../shared/domain/entities/compliance-item.entity';
import type { InventoryStock } from '../domain/entities/inventory-stock.entity';

@Injectable()
export class InventoryService {
  constructor(
    @Inject(STOCK_REPO)
    private readonly stockRepo: IStockRepository,
    @Inject(STOCK_MOVEMENT_REPO)
    private readonly movementRepo: IStockMovementRepository,
    @Optional()
    @Inject(ITEM_REPO)
    private readonly itemRepo?: IComplianceItemRepository,
    @Optional()
    @Inject(CONNECTION_REPO)
    private readonly connectionRepo?: IComplianceConnectionRepository,
    @Optional()
    @Inject(ETIMS_ADAPTER)
    private readonly etimsAdapter?: IEtimsAdapter,
  ) {}

  private shouldSyncToEtims(): boolean {
    return (process.env.ETIMS_STOCK_SYNC ?? '').toLowerCase() === 'true';
  }

  private async syncStockMasterToEtims(stock: InventoryStock): Promise<void> {
    if (!this.shouldSyncToEtims()) return;
    if (!this.itemRepo || !this.connectionRepo || !this.etimsAdapter) return;

    const adapter = this.etimsAdapter;

    const found = await this.itemRepo.findByIds([stock.itemId]);
    const item: ComplianceItem | null = found[0] ?? null;
    if (!item) return;

    const connection = await this.connectionRepo.findByMerchantAndBranch(
      item.merchantId,
      stock.branchId,
    );
    if (!connection) return;

    await adapter.saveStockMaster(
      {
        tin: connection.kraPin,
        bhfId: stock.branchId,
        cmcKey: connection.cmcKey,
        itemCd: item.etimsItemCode ?? stock.itemId,
        rsdQty: stock.quantityOnHand,
        regrId: 'sync2books',
        regrNm: 'sync2books',
        modrId: 'sync2books',
        modrNm: 'sync2books',
      },
      {
        merchantId: item.merchantId,
        branchId: stock.branchId,
        kraPin: connection.kraPin,
        environment: connection.environment,
        cmcKey: connection.cmcKey,
        deviceId: connection.deviceId,
      },
    );
  }

  async recordMovement(params: {
    itemId: string;
    branchId: string;
    movementType: MovementType;
    quantity: number;
    referenceType?: string | null;
    referenceId?: string | null;
  }) {
    const result = await recordMovement(
      params,
      this.stockRepo,
      this.movementRepo,
    );
    await this.syncStockMasterToEtims(result.stock);
    return result;
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
