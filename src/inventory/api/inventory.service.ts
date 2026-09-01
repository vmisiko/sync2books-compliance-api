import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
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
import { OscuSyncStateOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';
import {
  splitTaxInclusiveAmount,
  round2,
} from '../../regulatory/oscu/mapping/oscu-tax-rates';

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
    @Optional()
    @InjectRepository(OscuSyncStateOrmEntity)
    private readonly syncStateRepo?: Repository<OscuSyncStateOrmEntity>,
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

  private formatYyyyMMddUtc(date: Date): string {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
  }

  /**
   * KRA validates `sarNo` is strictly incrementing per tin, starting at 1 --
   * same requirement as the OSCU itemCd sequence (see sync-items.usecase.ts).
   * A timestamp-based sarNo will eventually collide with the sandbox's
   * "Invalid sarNo: Expected X" check, so persist a real counter instead.
   *
   * The read (findOne) and write (upsert) below run inside one transaction
   * with a `pessimistic_write` row lock -- same pattern as
   * StockTypeOrmRepository.applyDelta() -- so two concurrent allocations for
   * the same (kraPin, environment) serialize instead of racing: the second
   * transaction blocks on the locked row until the first commits its
   * increment, rather than reading the pre-increment value and silently
   * clobbering it. Without this, a read-then-write gap let two concurrent
   * insertStockIO calls both read the same lastReqDt and both write next+1,
   * permanently stranding the counter one ahead of KRA's true accepted value
   * (exactly what happened to tenant P600004185A/SANDBOX).
   *
   * Known accepted gap, same as applyDelta(): two concurrent *first-ever*
   * allocations for a brand-new (kraPin, environment) pair could both see no
   * row to lock and both upsert to 1, since there's nothing yet to lock.
   * Narrower than the bug this fixes (only the very first movement for a
   * pin can race, not every subsequent one), and self-heals the same way
   * any sarNo mismatch does: KRA rejects one of the two, and its
   * insertStockIO failure path calls releaseSarNo to roll the counter back.
   */
  private async allocateSarNo(
    kraPin: string,
    environment: string,
  ): Promise<number> {
    if (!this.syncStateRepo) return Date.now();
    const syncKey = `stock_sar_no:${kraPin}:${environment}`;
    return this.syncStateRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(OscuSyncStateOrmEntity);
      const existing = await repo.findOne({
        where: { syncKey },
        lock: { mode: 'pessimistic_write' },
      });
      const next =
        (existing?.lastReqDt ? parseInt(existing.lastReqDt, 10) : 0) + 1;
      await repo.upsert({ syncKey, lastReqDt: String(next) }, ['syncKey']);
      return next;
    });
  }

  /**
   * Unlike itemCd/invcNo, a sarNo is never persisted or reused on retry --
   * syncStockMovementToEtims allocates a fresh one on every call, and a
   * failed movement is only logged, not retried with the same value. So
   * there's no "keep it for a retry" case to protect: release on every
   * insertStockIO failure, retryable or not, or the counter permanently
   * drifts ahead of what KRA actually accepted. Only rolls back if no one
   * else has advanced past this value in the meantime.
   *
   * Done as a single atomic conditional UPDATE (WHERE syncKey = ? AND
   * lastReqDt = ?) rather than the old findOne-then-upsert: MySQL's row lock
   * on the UPDATE itself makes the "is this still the current value" check
   * and the write indivisible, so there's no gap in which another call's
   * allocateSarNo can advance the counter between our read and our write.
   * Same semantic as the old `current === sarNo` guard, just applied
   * atomically instead of racily.
   */
  private async releaseSarNo(
    kraPin: string,
    environment: string,
    sarNo: number,
  ): Promise<void> {
    if (!this.syncStateRepo) return;
    const syncKey = `stock_sar_no:${kraPin}:${environment}`;
    await this.syncStateRepo.update(
      { syncKey, lastReqDt: String(sarNo) },
      { lastReqDt: String(sarNo - 1) },
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
      case MovementType.RECONCILE:
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
    unitPrice?: number;
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
    if (!connection || !connection.kraBhfId) return;

    const ocrnDt = this.formatYyyyMMddUtc(movement.createdAt);
    const sarNo = await this.allocateSarNo(
      connection.kraPin,
      connection.environment,
    );
    const qty = Math.abs(movement.quantity);

    // KRA's sandbox rejects a literal 0 on `totAmt` ("Expected a value ... but it
    // is empty or null") and treats the line total as tax-INCLUSIVE (same rule as
    // sendSalesTransaction -- see oscu-tax-rates.ts). Without a real unit price we
    // can't build a valid request; log clearly instead of silently sending zeros
    // that are guaranteed to be rejected.
    const hasPricing =
      typeof params.unitPrice === 'number' && params.unitPrice > 0;
    if (!hasPricing) {
      this.logger.warn(
        `eTIMS insertStockIO skipped for ${item.id}: no unitPrice supplied for this ` +
          `movement, and KRA requires a real (non-zero) amount. Pass unitPrice to ` +
          `recordMovement()/adjustStock() to sync this movement to eTIMS.`,
      );
      return;
    }
    const unitPrice = params.unitPrice as number;
    const splyAmt = round2(qty * unitPrice);
    const { taxblAmt, taxAmt } = splitTaxInclusiveAmount(splyAmt, item.taxTyCd);
    const totAmt = splyAmt;

    try {
      const result = await adapter.insertStockIO(
        {
          tin: connection.kraPin,
          bhfId: connection.kraBhfId,
          cmcKey: connection.cmcKey,
          sarNo,
          orgSarNo: 0,
          regTyCd: this.mapRegTyCd(movement),
          custTin: null,
          custNm: null,
          custBhfId: null,
          sarTyCd: this.mapSarTyCd(movement),
          ocrnDt,
          totItemCnt: 1,
          totTaxblAmt: taxblAmt,
          totTaxAmt: taxAmt,
          totAmt,
          remark: movement.referenceId
            ? `${movement.referenceType ?? 'REF'}:${movement.referenceId}`
            : movement.referenceType,
          regrId: 'sync2books',
          regrNm: 'sync2books',
          modrId: 'sync2books',
          modrNm: 'sync2books',
          itemList: [
            {
              itemSeq: 1,
              itemCd,
              itemClsCd: item.classificationCode,
              itemNm: item.name,
              bcd: item.sku ?? null,
              pkgUnitCd: item.packagingUnitCode,
              // KRA rejects pkg: 0 ("Invalid pkg for ItemList N") -- see
              // oscu-sales-request.builder.ts for the same rule on sales.
              pkg: qty,
              qtyUnitCd: item.unitCode,
              qty,
              itemExprDt: null,
              prc: unitPrice,
              splyAmt,
              totDcAmt: 0,
              taxblAmt,
              taxTyCd: item.taxTyCd,
              taxAmt,
              totAmt,
            },
          ],
        },
        {
          merchantId: item.merchantId,
          branchId: connection.kraBhfId,
          kraPin: connection.kraPin,
          environment: connection.environment,
          cmcKey: connection.cmcKey,
          deviceId: connection.deviceId,
        },
      );
      if (!result.success) {
        this.logger.warn(
          `eTIMS insertStockIO rejected: itemCd=${itemCd} sarNo=${sarNo} ` +
            `movement=${movement.id} error=${result.error}`,
        );
        await this.releaseSarNo(
          connection.kraPin,
          connection.environment,
          sarNo,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `eTIMS insertStockIO failed: itemCd=${itemCd} sarNo=${sarNo} ` +
          `movement=${movement.id} error=${msg}`,
      );
      await this.releaseSarNo(connection.kraPin, connection.environment, sarNo);
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
    if (!connection || !connection.kraBhfId) return;

    try {
      const result = await adapter.saveStockMaster(
        {
          tin: connection.kraPin,
          bhfId: connection.kraBhfId,
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
          branchId: connection.kraBhfId,
          kraPin: connection.kraPin,
          environment: connection.environment,
          cmcKey: connection.cmcKey,
          deviceId: connection.deviceId,
        },
      );
      if (!result.success) {
        this.logger.warn(
          `eTIMS saveStockMaster rejected: itemCd=${itemCd} branch=${stock.branchId} ` +
            `rsdQty=${stock.quantityOnHand} error=${result.error}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `eTIMS saveStockMaster failed: itemCd=${itemCd} branch=${stock.branchId} ` +
          `rsdQty=${stock.quantityOnHand} error=${msg}`,
      );
    }
  }

  /**
   * Catches up KRA on an item's already-recorded local stock, right after
   * that item successfully registers (saveItem) -- confirmed live
   * 2026-09-01: any stock reconciled while an item was still PENDING (e.g.
   * during "Pull from QuickBooks", which reconciles qtyOnHand immediately
   * on pull, before the separate manual Item Sync step registers the item
   * with KRA) has its saveStockMaster/insertStockIO push silently no-op'd
   * by syncStockMasterToEtims/syncStockMovementToEtims's own etimsItemCode
   * gate -- and nothing re-sends it once registration completes, since
   * item-sync (sync-items.usecase.ts) has no knowledge of inventory at all.
   * The result: local stock shows a real quantity, but KRA never learns
   * about it unless someone happens to trigger another RECONCILE movement
   * afterward. Call this from the item-sync success path to close that gap.
   * A no-op if this item/branch has no stock row yet, or if
   * ETIMS_STOCK_MASTER_SYNC isn't enabled (same env-flag gate
   * syncStockMasterToEtims itself already applies).
   */
  async pushStockMasterCatchUp(
    itemId: string,
    branchId: string,
  ): Promise<void> {
    const stock = await this.stockRepo.getStock(itemId, branchId);
    if (!stock) return;
    await this.syncStockMasterToEtims(stock);
  }

  async recordMovement(params: {
    itemId: string;
    branchId: string;
    movementType: MovementType;
    quantity: number;
    referenceType?: string | null;
    referenceId?: string | null;
    sourceSystem?: string | null;
    /** Unit price for this movement -- required for the eTIMS insertStockIO sync
     * (KRA needs a real, non-zero amount). Not needed for the stock-quantity math
     * itself; omit it and the movement still records locally, it just won't sync. */
    unitPrice?: number;
  }) {
    const { unitPrice, ...movementParams } = params;
    const result = await recordMovement(
      movementParams,
      this.stockRepo,
      this.movementRepo,
    );
    await this.syncStockMovementToEtims({ ...result, unitPrice });
    // saveStockMaster is reconciliation-only: it sets KRA's resident-quantity
    // snapshot (rsdQty), not a per-movement ledger entry -- firing it after
    // every SALE/PURCHASE/TRANSFER would be both wrong (it's not what
    // saveStockMaster is for) and wasteful.
    if (result.movement.movementType === MovementType.RECONCILE) {
      await this.syncStockMasterToEtims(result.stock);
    }
    return result;
  }

  /**
   * Reconcile local stock against an external system's quantity (e.g.
   * QuickBooks QtyOnHand) -- diffs against the current on-hand quantity and
   * records the delta as a RECONCILE movement, never a blind overwrite.
   */
  async reconcileStock(params: {
    itemId: string;
    branchId: string;
    externalQtyOnHand: number;
    sourceSystem?: string;
    referenceId?: string;
    unitPrice?: number;
  }) {
    const current = await this.stockRepo.getStock(
      params.itemId,
      params.branchId,
    );
    const delta = params.externalQtyOnHand - (current?.quantityOnHand ?? 0);
    return this.recordMovement({
      itemId: params.itemId,
      branchId: params.branchId,
      movementType: MovementType.RECONCILE,
      quantity: delta,
      referenceType: 'RECONCILE',
      referenceId: params.referenceId ?? null,
      sourceSystem: params.sourceSystem ?? 'QUICKBOOKS',
      unitPrice: params.unitPrice,
    });
  }

  async listStock(branchId?: string) {
    return this.stockRepo.listByBranch(branchId);
  }

  async listMovements(params: {
    itemId?: string;
    branchId?: string;
    limit?: number;
  }) {
    return this.movementRepo.list(params);
  }

  async adjustStock(params: {
    itemId: string;
    branchId: string;
    quantity: number;
    action: 'ADD' | 'DEDUCT';
    movementTypeCode?: string;
    referenceId?: string;
    unitPrice?: number;
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
      unitPrice: params.unitPrice,
    });
  }

  async transferStock(params: {
    itemId: string;
    fromBranchId: string;
    receivingItemId: string;
    toBranchId: string;
    quantity: number;
    referenceId?: string;
    unitPrice?: number;
  }) {
    const refId = params.referenceId ?? `xfer-${Date.now()}`;
    const out = await this.recordMovement({
      itemId: params.itemId,
      branchId: params.fromBranchId,
      movementType: MovementType.TRANSFER_OUT,
      quantity: params.quantity,
      referenceType: 'TRANSFER',
      referenceId: refId,
      unitPrice: params.unitPrice,
    });

    try {
      const into = await this.recordMovement({
        itemId: params.receivingItemId,
        branchId: params.toBranchId,
        movementType: MovementType.TRANSFER_IN,
        quantity: params.quantity,
        referenceType: 'TRANSFER',
        referenceId: refId,
        unitPrice: params.unitPrice,
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
