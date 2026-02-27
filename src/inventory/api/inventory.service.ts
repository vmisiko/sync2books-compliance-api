import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
import type { StockMovement } from '../domain/entities/stock-movement.entity';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

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

  private shouldSyncMovementsToEtims(): boolean {
    return (process.env.ETIMS_STOCK_SYNC ?? '').toLowerCase() === 'true';
  }

  private shouldSyncStockMasterToEtims(): boolean {
    return (process.env.ETIMS_STOCK_MASTER_SYNC ?? '').toLowerCase() === 'true';
  }

  private formatYyyyMMddhhmmssUtc(date: Date): string {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return (
      `${date.getUTCFullYear()}` +
      `${pad2(date.getUTCMonth() + 1)}` +
      `${pad2(date.getUTCDate())}` +
      `${pad2(date.getUTCHours())}` +
      `${pad2(date.getUTCMinutes())}` +
      `${pad2(date.getUTCSeconds())}`
    );
  }

  private mapSarTyCd(movement: StockMovement): string {
    // OSCU code classification 12: Stock In/Out (OSCU v2.0 spec §4.15)
    // Incoming: 01(import) 02(purchase) 03(return) 04(stock movement) 05(adjustment) 06(processing)
    // Outgoing: 11(sale) 12(return) 13(stock movement) 14(processing) 15(discarding) 16(adjustment)
    switch (movement.movementType) {
      case MovementType.SALE:
        return '11';
      case MovementType.PURCHASE:
        return '02';
      case MovementType.RETURN:
        return '03';
      case MovementType.TRANSFER_IN:
        return '04';
      case MovementType.TRANSFER_OUT:
        return '13';
      case MovementType.ADJUSTMENT:
        return movement.quantity >= 0 ? '05' : '16';
      default:
        return movement.quantity >= 0 ? '05' : '16';
    }
  }

  private mapRegTyCd(movement: StockMovement): 'A' | 'M' {
    // OSCU code classification 31: Registration Type (Automatic/Manual)
    const rt = (movement.referenceType ?? '').toUpperCase();
    if (rt.startsWith('MANUAL_') || rt.includes('MANUAL')) return 'M';
    return 'A';
  }

  private async syncStockMovementToEtims(params: {
    movement: StockMovement;
    stock: InventoryStock;
  }): Promise<void> {
    if (!this.shouldSyncMovementsToEtims()) return;
    if (!this.itemRepo || !this.connectionRepo || !this.etimsAdapter) return;

    const { movement, stock } = params;
    const adapter = this.etimsAdapter;

    const found = await this.itemRepo.findByIds([movement.itemId]);
    const item: ComplianceItem | null = found[0] ?? null;
    if (!item) return;

    const itemCd =
      typeof item.etimsItemCode === 'string' && item.etimsItemCode.trim() !== ''
        ? item.etimsItemCode
        : null;
    if (!itemCd) return;

    const connection = await this.connectionRepo.findByMerchantAndBranch(
      item.merchantId,
      stock.branchId,
    );
    if (!connection) return;

    const ocrnDt = this.formatYyyyMMddhhmmssUtc(movement.createdAt);
    const sarNo = movement.createdAt.getTime();
    const qty = Math.abs(movement.quantity);

    try {
      await adapter.insertStockIO(
        {
          tin: connection.kraPin,
          bhfId: stock.branchId,
          cmcKey: connection.cmcKey,
          sarNo,
          itemList: [
            {
              orgSarNo: null,
              regTyCd: this.mapRegTyCd(movement),
              custTin: null,
              custNm: null,
              custBhfId: null,
              sarTyCd: this.mapSarTyCd(movement),
              ocrnDt,
              totItemCnt: 1,
              totTaxblAmt: 0,
              totTaxAmt: 0,
              totAmt: 0,
              remark: movement.referenceId
                ? `${movement.referenceType ?? 'REF'}:${movement.referenceId}`
                : movement.referenceType,
              regrId: 'sync2books',
              regrNm: 'sync2books',
              modrId: 'sync2books',
              modrNm: 'sync2books',
              itemSeq: 1,
              itemCd,
              itemClsCd: item.classificationCode,
              itemNm: item.name,
              bcd: item.sku ?? null,
              pkgUnitCd: item.packagingUnitCode,
              pkg: 0,
              qtyUnitCd: item.unitCode,
              qty,
              itemExprDt: null,
              prc: 0,
              splyAmt: 0,
              totDcAmt: 0,
              taxblAmt: 0,
              taxTyCd: item.taxTyCd,
              taxAmt: 0,
            },
          ],
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`eTIMS insertStockIO failed: ${msg}`);
    }
  }

  private async syncStockMasterToEtims(stock: InventoryStock): Promise<void> {
    if (!this.shouldSyncStockMasterToEtims()) return;
    if (!this.itemRepo || !this.connectionRepo || !this.etimsAdapter) return;

    const adapter = this.etimsAdapter;

    const found = await this.itemRepo.findByIds([stock.itemId]);
    const item: ComplianceItem | null = found[0] ?? null;
    if (!item) return;

    const itemCd =
      typeof item.etimsItemCode === 'string' && item.etimsItemCode.trim() !== ''
        ? item.etimsItemCode
        : null;
    if (!itemCd) return;

    const connection = await this.connectionRepo.findByMerchantAndBranch(
      item.merchantId,
      stock.branchId,
    );
    if (!connection) return;

    try {
      await adapter.saveStockMaster(
        {
          tin: connection.kraPin,
          bhfId: stock.branchId,
          cmcKey: connection.cmcKey,
          itemCd,
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`eTIMS saveStockMaster failed: ${msg}`);
    }
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
    await this.syncStockMovementToEtims(result);
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
