import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { recordMovement } from '../application/use-cases/record-movement.usecase';
import { getStockLevel } from '../application/use-cases/get-stock-level.usecase';
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
import type { OscuStockIOSaveReq } from '../../regulatory/oscu/transport/endpoints/stock-io-save.dto';
import {
  isRsdQtyLedgerMismatch,
  parseExpectedSarNo,
  parseRsdQtyMismatch,
} from '../../regulatory/oscu/mapping/oscu-sequence-drift';
import { deriveKraLedgerQty } from '../../regulatory/oscu/mapping/oscu-stock-ledger';
import type { ComplianceConnection } from '../../shared/domain/entities/compliance-connection.entity';
import {
  deriveItemType,
  type ComplianceItem,
} from '../../shared/domain/entities/compliance-item.entity';
import { ItemType } from '../../shared/domain/enums/item-type.enum';
import type { InventoryStock } from '../domain/entities/inventory-stock.entity';
import type { StockMovement } from '../domain/entities/stock-movement.entity';
import { OscuSyncStateOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import {
  splitTaxInclusiveAmount,
  round2,
} from '../../regulatory/oscu/mapping/oscu-tax-rates';

/**
 * Movement types that restate on-hand quantity from outside KRA's own document
 * flow, so KRA's resident-quantity snapshot (`rsdQty`) has to follow them:
 * RECONCILE (a diff against an ERP's QtyOnHand) and ADJUSTMENT (a manual
 * dashboard add/deduct -- the only way a manually-created item ever gets a
 * quantity, so nothing else will ever tell KRA about it).
 *
 * SALE/PURCHASE/TRANSFER/RETURN stay out deliberately: KRA already derives
 * stock from the sales and purchase documents themselves, so pushing
 * saveStockMaster after each one would be both wrong (it's not what
 * saveStockMaster is for) and wasteful.
 */
const STOCK_MASTER_SYNC_MOVEMENT_TYPES: readonly MovementType[] = [
  MovementType.RECONCILE,
  MovementType.ADJUSTMENT,
];

export type EtimsPushStatus = 'ok' | 'skipped' | 'failed';

/**
 * What actually reached KRA for one movement, reported back to the caller.
 *
 * Both eTIMS pushes are best-effort by design -- they log and swallow rather
 * than failing the local stock write, so a partial KRA outage never blocks
 * bookkeeping. The cost of that is a caller who sees HTTP 200 and reports
 * "Stock adjusted" while nothing moved on the tax side, which is exactly how
 * a dashboard stock edit can look applied and still leave the item missing
 * from KRA's stock master. Returning the outcome is what lets the caller tell
 * the difference.
 *
 * `skipped` is a deliberate no-send (feature flag off, Service item, item not
 * registered yet, no price); `failed` is KRA, or the transport, saying no.
 */
/**
 * The evidence behind a `failed`, carried back to the caller instead of
 * living only in a server log line.
 *
 * Every KRA stock problem this project has hit was diagnosed by reading the
 * exact request/response pair, and until now that meant tailing the API
 * console while re-clicking the button -- the dashboard only ever saw a
 * one-line reason. This is the same information, attached to the failure.
 *
 * Only named fields go in: `cmcKey`, bearer tokens and the rest of the
 * connection context are never part of it.
 */
export interface EtimsPushDetail {
  /** OSCU endpoint, e.g. `saveStockMaster`. */
  endpoint: string;
  itemCd?: string;
  branchId?: string;
  /** The values that decide whether KRA accepts -- not the whole payload. */
  sent?: Record<string, unknown>;
  /** KRA's reply, verbatim. */
  kraResponse?: unknown;
  /**
   * KRA's own view of this item's Stock IO ledger, fetched only when a
   * rejection says the ledger disagrees but not by how much.
   */
  kraStockLedger?: unknown;
}

export interface EtimsPushOutcome {
  status: EtimsPushStatus;
  /** Why -- set for skipped and failed. Phrased to be safe to show a user. */
  reason?: string;
  detail?: EtimsPushDetail;
}

export interface EtimsStockPushOutcome {
  /** `insertStockIO` -- the per-movement Stock IO ledger entry. */
  stockIo: EtimsPushOutcome;
  /**
   * `saveStockMaster` -- the resident-quantity (`rsdQty`) snapshot. Only
   * attempted for {@link STOCK_MASTER_SYNC_MOVEMENT_TYPES}; `skipped` for
   * every other movement type.
   */
  stockMaster: EtimsPushOutcome;
}

const pushOk = (): EtimsPushOutcome => ({ status: 'ok' });
const pushSkipped = (reason: string): EtimsPushOutcome => ({
  status: 'skipped',
  reason,
});
const pushFailed = (
  reason: string,
  detail?: EtimsPushDetail,
): EtimsPushOutcome => ({
  status: 'failed',
  reason,
  ...(detail ? { detail } : {}),
});

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
    /**
     * Branch-id canonicalization (see {@link toCanonicalBranchId}). Optional
     * only so the plain unit specs in this folder can construct the service
     * with stub repositories and literal branch ids; InventoryModule always
     * provides it, and without it every branch id is written through
     * unchanged -- which is the pre-canonicalization behaviour, not a silent
     * data change.
     */
    @Optional()
    private readonly organization?: ComplianceOrganizationApplicationService,
  ) {}

  /**
   * `inventory_stock.branchId` / `stock_movements.branchId` are keyed by the
   * canonical branch id (`ComplianceBranch.id`), but callers legitimately
   * arrive holding either form: Mode A (main API) forwards its own branch key
   * -- `branch.sync2booksBranchId ?? branch.id`, typically `'00'` -- while
   * Mode B (compliance dashboard) resolves `branch.id` directly via
   * ComplianceOrganizationApplicationService.resolveDashboardBranchId. Left
   * unnormalized, one logical item+branch pair gets two stock rows, and
   * {@link syncStockMasterToEtims} then reports whichever row the caller's
   * branch id resolved to as KRA's resident quantity (`rsdQty`) -- a wrong
   * `rsdQty` is a wrong tax filing, not a display glitch.
   *
   * Resolution is tenant-scoped through the item's `merchantId` because
   * `sync2booksBranchId` is unique only per tenant; a bare `'00'` looked up
   * globally would match another tenant's branch. An id we can't resolve
   * (unknown item, unprovisioned tenant, no matching branch) passes through
   * untouched rather than failing the write.
   */
  private async toCanonicalBranchId(
    itemId: string,
    branchId: string,
  ): Promise<string> {
    if (!this.organization || !this.itemRepo) return branchId;
    try {
      const [item] = await this.itemRepo.findByIds([itemId]);
      if (!item) return branchId;
      const canonical =
        await this.organization.resolveCanonicalBranchIdForMerchant(
          item.merchantId,
          branchId,
        );
      if (canonical && canonical !== branchId) {
        this.logger.debug(
          `Canonicalized branch id ${branchId} -> ${canonical} for item ${itemId}`,
        );
      }
      return canonical ?? branchId;
    } catch (error) {
      this.logger.warn(
        `Branch-id canonicalization failed for item ${itemId} branch ${branchId}; ` +
          `using it as given: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      return branchId;
    }
  }

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
  /**
   * Overwrites the counter to `sarNo` so it reads as "this value is the latest
   * allocated" -- the next allocateSarNo() therefore returns sarNo + 1. Used
   * only by the drift correction, which then sends `sarNo` itself.
   *
   * Deliberately an unconditional overwrite rather than a Math.max: when this
   * runs, the local value is precisely the one KRA has told us is wrong, so
   * preserving it is never right. Same reasoning as
   * resyncItemCdSequenceFromKra's refusal to take Math.max(previous, kra).
   */
  private async forceSarNo(
    kraPin: string,
    environment: string,
    sarNo: number,
  ): Promise<void> {
    if (!this.syncStateRepo) return;
    const syncKey = `stock_sar_no:${kraPin}:${environment}`;
    await this.syncStateRepo.upsert({ syncKey, lastReqDt: String(sarNo) }, [
      'syncKey',
    ]);
  }

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
  }): Promise<EtimsPushOutcome> {
    if (!this.shouldSyncMovementsToEtims()) {
      return pushSkipped('eTIMS stock sync is disabled (ETIMS_STOCK_SYNC)');
    }
    if (!this.itemRepo || !this.connectionRepo || !this.etimsAdapter) {
      return pushSkipped('eTIMS stock sync is not wired up in this context');
    }

    const { movement, stock } = params;

    const found = await this.itemRepo.findByIds([movement.itemId]);
    const item: ComplianceItem | null = found[0] ?? null;
    if (!item) return pushSkipped(`Item ${movement.itemId} not found`);

    // A Service (itemTyCd '3') is not stock-tracked -- KRA has no stock
    // master row for it, so a insertStockIO call naming its itemCd is rejected. Normally
    // unreachable (services never get a stock row seeded, and
    // SalesService.applyInventoryMovements skips them), but an item
    // reclassified from Goods to Service keeps whatever stock row it already
    // had, and adjust/reconcile reach recordMovement without any such check.
    // Guard at the eTIMS boundary so every caller is covered at once.
    if (deriveItemType(item.productTypeCode) === ItemType.SERVICE) {
      this.logger.debug(
        `eTIMS insertStockIO skipped for ${item.id}: item is a Service (itemTyCd 3), not stock-tracked`,
      );
      return pushSkipped('Services are not stock-tracked by KRA');
    }

    const itemCd =
      typeof item.etimsItemCode === 'string' && item.etimsItemCode.trim() !== ''
        ? item.etimsItemCode
        : null;
    if (!itemCd) {
      return pushSkipped(
        'Item is not registered with KRA yet (no itemCd) — run Item Sync first',
      );
    }

    const connection = await this.connectionRepo.findByMerchantAndBranch(
      item.merchantId,
      stock.branchId,
    );
    if (!connection || !connection.kraBhfId) {
      return pushSkipped('No initialized eTIMS connection for this branch');
    }

    // KRA's sandbox rejects a literal 0 on `totAmt` ("Expected a value ... but it
    // is empty or null") and treats the line total as tax-INCLUSIVE (same rule as
    // sendSalesTransaction -- see oscu-tax-rates.ts). Without a real unit price we
    // can't build a valid request; log clearly instead of silently sending zeros
    // that are guaranteed to be rejected.
    //
    // Falls back to the item's own catalog price when the caller has none.
    // Skipping insertStockIO is NOT a harmless "ledger entry missing": KRA
    // derives the rsdQty it expects on saveStockMaster from the accumulated
    // Stock IO ledger, so a movement that never reaches the ledger makes the
    // very next saveStockMaster fail with "rsdQty mismatch. Expected: 0.0 but
    // found: N" -- and the item stays absent from KRA's stock master, which
    // surfaces two steps later as a *sale* rejected for "Invalid Item: Item
    // <itemCd> does not exist in your stock master". The dashboard's inline
    // stock edit sends no price (there is nowhere to type one), so without
    // this fallback that edit could never reach KRA at all.
    const resolvedUnitPrice =
      typeof params.unitPrice === 'number' && params.unitPrice > 0
        ? params.unitPrice
        : typeof item.unitPrice === 'number' && item.unitPrice > 0
          ? item.unitPrice
          : null;
    if (resolvedUnitPrice === null) {
      this.logger.warn(
        `eTIMS insertStockIO skipped for ${item.id}: no unitPrice supplied for this ` +
          `movement and the item has no catalog price, and KRA requires a real ` +
          `(non-zero) amount. Set a unit price on the item, or pass unitPrice to ` +
          `recordMovement()/adjustStock(), to sync this movement to eTIMS.`,
      );
      return pushSkipped(
        'No unit price: this item has no catalog price and none was supplied, ' +
          'and KRA rejects a zero-amount stock movement',
      );
    }
    return this.sendStockIo({
      item,
      itemCd,
      connection,
      qty: Math.abs(movement.quantity),
      unitPrice: resolvedUnitPrice,
      sarTyCd: this.mapSarTyCd(movement),
      regTyCd: this.mapRegTyCd(movement),
      ocrnDt: this.formatYyyyMMddUtc(movement.createdAt),
      remark: movement.referenceId
        ? `${movement.referenceType ?? 'REF'}:${movement.referenceId}`
        : movement.referenceType,
      logContext: `movement=${movement.id}`,
    });
  }

  /**
   * Sends one `insertStockIO` -- the Stock IO ledger entry -- allocating and,
   * where KRA disagrees, self-correcting the `sarNo` around it.
   *
   * Extracted from {@link syncStockMovementToEtims} because the stock-master
   * push needs the identical call for a different reason: not to mirror a
   * local movement, but to close the gap between KRA's ledger and the quantity
   * we are about to declare (see the rsdQty repair in
   * {@link syncStockMasterToEtims}). Both callers must share one
   * sarNo-allocating, drift-correcting path -- two copies of that would drift
   * the counter against each other.
   *
   * `qty` is unsigned; direction is carried by `sarTyCd` (incoming 01-06,
   * outgoing 11-16), which is how OSCU expresses it.
   */
  private async sendStockIo(params: {
    item: ComplianceItem;
    itemCd: string;
    connection: ComplianceConnection;
    qty: number;
    unitPrice: number;
    sarTyCd: string;
    regTyCd: 'A' | 'M';
    ocrnDt: string;
    remark: string | null;
    /** Identifies the caller in log lines, e.g. `movement=<id>`. */
    logContext: string;
  }): Promise<EtimsPushOutcome> {
    const adapter = this.etimsAdapter;
    if (!adapter) {
      return pushSkipped('eTIMS stock sync is not wired up in this context');
    }
    const { item, itemCd, connection, qty, unitPrice, logContext } = params;
    const kraBhfId = connection.kraBhfId;
    if (!kraBhfId) {
      return pushSkipped('No initialized eTIMS connection for this branch');
    }

    let sarNo = await this.allocateSarNo(
      connection.kraPin,
      connection.environment,
    );

    const splyAmt = round2(qty * unitPrice);
    const { taxblAmt, taxAmt } = splitTaxInclusiveAmount(splyAmt, item.taxTyCd);
    const totAmt = splyAmt;

    const connectionContext = {
      merchantId: item.merchantId,
      branchId: kraBhfId,
      kraPin: connection.kraPin,
      environment: connection.environment,
      cmcKey: connection.cmcKey,
      deviceId: connection.deviceId,
    };

    // Built per attempt so the sarNo drift correction below can rebuild the
    // request with the value KRA actually expects, instead of duplicating this
    // payload at a second call site.
    const buildRequest = (sar: number): OscuStockIOSaveReq => ({
      tin: connection.kraPin,
      bhfId: kraBhfId,
      cmcKey: connection.cmcKey,
      sarNo: sar,
      orgSarNo: 0,
      regTyCd: params.regTyCd,
      custTin: null,
      custNm: null,
      custBhfId: null,
      sarTyCd: params.sarTyCd,
      ocrnDt: params.ocrnDt,
      totItemCnt: 1,
      totTaxblAmt: taxblAmt,
      totTaxAmt: taxAmt,
      totAmt,
      remark: params.remark,
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
          // oscu-sales-request.builder.ts for the same rule on sales. NOTE:
          // unlike sendSalesTransaction, insertStockIO has a confirmed-live
          // success with pkg == qty (pkg: 10, qty: 10, see oscu-payload-gotchas.md),
          // so do NOT force pkg to 1 here without live-testing insertStockIO
          // specifically -- KRA validates these endpoints inconsistently.
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
    });

    // One drift correction per movement, then give up: bounded so a rejection
    // that merely looks like drift can never loop.
    let driftCorrected = false;
    for (;;) {
      let result: Awaited<ReturnType<IEtimsAdapter['insertStockIO']>>;
      try {
        result = await adapter.insertStockIO(
          buildRequest(sarNo),
          connectionContext,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `eTIMS insertStockIO failed: itemCd=${itemCd} sarNo=${sarNo} ` +
            `${logContext} error=${msg}`,
        );
        await this.releaseSarNo(
          connection.kraPin,
          connection.environment,
          sarNo,
        );
        return pushFailed(msg, {
          endpoint: 'insertStockIO',
          itemCd,
          branchId: kraBhfId,
          sent: { sarNo, sarTyCd: params.sarTyCd, qty, prc: unitPrice, totAmt },
        });
      }

      if (result.success) return pushOk();

      // KRA names the sarNo it expects in the rejection itself, so this needs
      // no probe call -- contrast the itemCd sequence, whose rejection reveals
      // nothing and therefore costs a /itemInfo round trip to repair (see
      // fetchMaxItemCdSeqFromKra). Overwrite the counter and retry once.
      //
      // Deliberately does NOT releaseSarNo on this path: releasing would
      // decrement the counter this correction just set, re-stranding it one
      // behind and guaranteeing the retry fails too. Same rule as the itemCd
      // loop, where a drift rejection never releases its sequence back.
      const expected = parseExpectedSarNo(
        result.error ?? result.rawResponse?.resultMsg ?? null,
      );
      if (expected !== null && !driftCorrected) {
        driftCorrected = true;
        this.logger.warn(
          `eTIMS insertStockIO sarNo drift: itemCd=${itemCd} sent=${sarNo} ` +
            `expected=${expected} ${logContext} -- ` +
            `correcting counter and retrying once`,
        );
        await this.forceSarNo(
          connection.kraPin,
          connection.environment,
          expected,
        );
        sarNo = expected;
        continue;
      }

      this.logger.warn(
        `eTIMS insertStockIO rejected: itemCd=${itemCd} sarNo=${sarNo} ` +
          `${logContext} error=${result.error} raw=${JSON.stringify(result.rawResponse ?? null)}`,
      );
      await this.releaseSarNo(connection.kraPin, connection.environment, sarNo);
      return pushFailed(result.error ?? 'KRA rejected the stock movement', {
        endpoint: 'insertStockIO',
        itemCd,
        branchId: kraBhfId,
        sent: { sarNo, sarTyCd: params.sarTyCd, qty, prc: unitPrice, totAmt },
        kraResponse: result.rawResponse ?? null,
      });
    }
  }

  private async syncStockMasterToEtims(
    stock: InventoryStock,
  ): Promise<EtimsPushOutcome> {
    if (!this.shouldSyncStockMasterToEtims()) {
      return pushSkipped(
        'eTIMS stock-master sync is disabled (ETIMS_STOCK_MASTER_SYNC)',
      );
    }
    if (!this.itemRepo || !this.connectionRepo || !this.etimsAdapter) {
      return pushSkipped(
        'eTIMS stock-master sync is not wired up in this context',
      );
    }

    const adapter = this.etimsAdapter;

    const found = await this.itemRepo.findByIds([stock.itemId]);
    const item: ComplianceItem | null = found[0] ?? null;
    if (!item) return pushSkipped(`Item ${stock.itemId} not found`);

    // A Service (itemTyCd '3') is not stock-tracked -- KRA has no stock
    // master row for it, so a saveStockMaster call naming its itemCd is rejected. Normally
    // unreachable (services never get a stock row seeded, and
    // SalesService.applyInventoryMovements skips them), but an item
    // reclassified from Goods to Service keeps whatever stock row it already
    // had, and adjust/reconcile reach recordMovement without any such check.
    // Guard at the eTIMS boundary so every caller is covered at once.
    if (deriveItemType(item.productTypeCode) === ItemType.SERVICE) {
      this.logger.debug(
        `eTIMS saveStockMaster skipped for ${item.id}: item is a Service (itemTyCd 3), not stock-tracked`,
      );
      return pushSkipped('Services are not stock-tracked by KRA');
    }

    const itemCd =
      typeof item.etimsItemCode === 'string' && item.etimsItemCode.trim() !== ''
        ? item.etimsItemCode
        : null;
    if (!itemCd) {
      return pushSkipped(
        'Item is not registered with KRA yet (no itemCd) — run Item Sync first',
      );
    }

    const connection = await this.connectionRepo.findByMerchantAndBranch(
      item.merchantId,
      stock.branchId,
    );
    if (!connection || !connection.kraBhfId) {
      return pushSkipped('No initialized eTIMS connection for this branch');
    }

    const kraBhfId = connection.kraBhfId;
    const send = async () =>
      adapter.saveStockMaster(
        {
          tin: connection.kraPin,
          bhfId: kraBhfId,
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
          branchId: kraBhfId,
          kraPin: connection.kraPin,
          environment: connection.environment,
          cmcKey: connection.cmcKey,
          deviceId: connection.deviceId,
        },
      );

    const baseDetail = (): EtimsPushDetail => ({
      endpoint: 'saveStockMaster',
      itemCd,
      branchId: kraBhfId,
      sent: { rsdQty: stock.quantityOnHand },
    });

    // One ledger repair per push, then give up -- bounded for the same reason
    // the sarNo correction is: a rejection that merely looks like drift must
    // not be able to loop.
    let ledgerRepaired = false;
    for (;;) {
      let result: Awaited<ReturnType<IEtimsAdapter['saveStockMaster']>>;
      try {
        result = await send();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `eTIMS saveStockMaster failed: itemCd=${itemCd} branch=${stock.branchId} ` +
            `rsdQty=${stock.quantityOnHand} error=${msg}`,
        );
        return pushFailed(msg, baseDetail());
      }

      if (result.success) return pushOk();

      const rejection = result.error ?? result.rawResponse?.resultMsg ?? null;
      this.logger.warn(
        `eTIMS saveStockMaster rejected: itemCd=${itemCd} branch=${stock.branchId} ` +
          `rsdQty=${stock.quantityOnHand} error=${rejection} ` +
          `raw=${JSON.stringify(result.rawResponse ?? null)}`,
      );
      const detail: EtimsPushDetail = {
        ...baseDetail(),
        kraResponse: result.rawResponse ?? null,
      };

      if (!isRsdQtyLedgerMismatch(rejection) || ledgerRepaired) {
        return pushFailed(
          rejection ?? 'KRA rejected the stock-master quantity',
          detail,
        );
      }
      ledgerRepaired = true;

      // KRA uses two wordings for this one condition, and only one of them
      // names the numbers (see isRsdQtyLedgerMismatch). With the numbers, the
      // gap is the missing ledger entry and we can send it.
      const mismatch = parseRsdQtyMismatch(rejection);
      if (mismatch !== null) {
        const repair = await this.repairStockLedgerGap({
          item,
          itemCd,
          connection,
          stock,
          mismatch,
        });
        if (repair.status === 'ok') continue;
        return pushFailed(
          `KRA's stock ledger for this item is behind by ${round2(
            mismatch.found - mismatch.expected,
          )} and could not be corrected automatically: ${
            repair.reason ?? rejection ?? 'unknown error'
          }`,
          detail,
        );
      }

      // Without the numbers there is nothing to send -- guessing a correction
      // here would write a wrong quantity into a tax filing. Fetch KRA's own
      // ledger for the item instead, so the gap is at least visible to whoever
      // is looking, and report a reason that says what to do about it.
      detail.kraStockLedger = await this.probeKraStockLedger(
        itemCd,
        item.merchantId,
        connection,
      );
      return pushFailed(
        `KRA's Stock IO ledger for ${itemCd} disagrees with the ` +
          `${stock.quantityOnHand} on hand here, and this rejection doesn't say ` +
          `by how much. KRA derives the quantity it will accept from that ledger, ` +
          `so the movements that never reached it have to be replayed before this ` +
          `quantity can be declared — see the KRA ledger in this error's detail.`,
        detail,
      );
    }
  }

  /**
   * Reads KRA's own Stock IO ledger for one item, purely so a rejection that
   * says "your quantity disagrees with the ledger" without saying by how much
   * stops being a dead end.
   *
   * Deliberately diagnostic and not corrective. The documented StockMoveRes
   * carries no `sarTyCd` on the returned movements, so there is no reliable
   * way to sign them and total them up -- and a *guessed* total here would be
   * written straight into `rsdQty`, which is a tax filing. Returning the raw
   * response puts the real shape in front of a human; a numeric repair built
   * on top of it should be written against an actual captured response, not
   * against the spec's field table.
   *
   * Never throws: this runs on a path that has already failed, and a failed
   * probe must not replace the real rejection with a probe error.
   */
  private async probeKraStockLedger(
    itemCd: string,
    merchantId: string,
    connection: ComplianceConnection,
  ): Promise<unknown> {
    const adapter = this.etimsAdapter;
    const kraBhfId = connection.kraBhfId;
    if (!adapter?.selectStockMoveList || !kraBhfId) return null;
    try {
      const result = await adapter.selectStockMoveList(
        {
          tin: connection.kraPin,
          bhfId: kraBhfId,
          cmcKey: connection.cmcKey,
          // Everything KRA holds, not a recent window -- the movements that
          // went missing are by definition old ones.
          lastReqDt: '20180101000000',
        },
        {
          merchantId,
          branchId: kraBhfId,
          kraPin: connection.kraPin,
          environment: connection.environment,
          cmcKey: connection.cmcKey,
          deviceId: connection.deviceId,
        },
      );
      this.logger.warn(
        `eTIMS stock-ledger probe for itemCd=${itemCd} branch=${kraBhfId}: ` +
          `${JSON.stringify(result.rawResponse ?? { error: result.error })}`,
      );
      return result.rawResponse ?? { error: result.error ?? 'no response' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `eTIMS stock-ledger probe failed for itemCd=${itemCd}: ${msg}`,
      );
      return { error: msg };
    }
  }

  /**
   * Closes the gap between KRA's Stock IO ledger and the quantity we just
   * declared, by sending the difference as one `insertStockIO`.
   *
   * KRA does not take `rsdQty` at face value -- it checks it against the
   * running total of that item's Stock IO ledger, and rejects a declaration
   * that disagrees. So a stock movement that never reached the ledger (most
   * often because it carried no unit price, so `sendStockIo` skipped it) does
   * not just lose an audit row: it strands the item's rsdQty permanently, and
   * the visible symptom lands two steps away, on a *sale* rejected for
   * "Invalid Item: Item <itemCd> does not exist in your stock master".
   *
   * `found - expected` is exactly the missing movement, so sending it as an
   * adjustment (incoming '05' / outgoing '16', the same codes a manual
   * adjustment uses) makes the ledger agree with what we are declaring --
   * after which the caller's retry of saveStockMaster succeeds. This is a
   * correction of our own omission, not a merchant action, so `regTyCd` is
   * 'A' (automatic).
   *
   * Needs a unit price like any other ledger entry; with none, the gap simply
   * cannot be closed and the caller reports that rather than retrying blind.
   */
  private async repairStockLedgerGap(params: {
    item: ComplianceItem;
    itemCd: string;
    connection: ComplianceConnection;
    stock: InventoryStock;
    mismatch: { expected: number; found: number };
  }): Promise<EtimsPushOutcome> {
    const { item, itemCd, connection, stock, mismatch } = params;
    const gap = round2(mismatch.found - mismatch.expected);
    if (gap === 0) {
      return pushSkipped('KRA reported a mismatch with no difference to close');
    }

    const unitPrice =
      typeof item.unitPrice === 'number' && item.unitPrice > 0
        ? item.unitPrice
        : null;
    if (unitPrice === null) {
      return pushSkipped(
        'the item has no unit price, and KRA rejects a zero-amount stock movement',
      );
    }

    this.logger.warn(
      `eTIMS stock ledger behind KRA: itemCd=${itemCd} branch=${stock.branchId} ` +
        `expected=${mismatch.expected} declared=${mismatch.found} -- ` +
        `sending a ${gap > 0 ? '+' : ''}${gap} adjustment to close the gap, then retrying once`,
    );

    return this.sendStockIo({
      item,
      itemCd,
      connection,
      qty: Math.abs(gap),
      unitPrice,
      // OSCU code classification 12: 05 incoming adjustment, 16 outgoing.
      sarTyCd: gap > 0 ? '05' : '16',
      regTyCd: 'A',
      ocrnDt: this.formatYyyyMMddUtc(new Date()),
      remark: 'RSDQTY_LEDGER_REPAIR',
      logContext: `stock-master-repair item=${item.id} branch=${stock.branchId}`,
    });
  }

  /**
   * Brings KRA's Stock IO ledger for one item into agreement with the local
   * on-hand quantity, then declares that quantity -- **without recording a
   * local stock movement**.
   *
   * This is the lever the two automatic self-heals can't be. KRA validates
   * `rsdQty` against the ledger's running total, and the arithmetic of a
   * normal adjustment can never close a gap between them: an adjustment of Δ
   * moves local on-hand to L+Δ *and* the ledger to K+Δ, then declares L+Δ,
   * which is accepted only if L already equalled K. So an item whose ledger
   * fell behind -- most often because its movements predate the unit-price
   * fallback and were skipped -- stays stuck no matter how many times anyone
   * retries the edit, and each retry appends another ledger entry that leaves
   * the gap exactly as wide. Only a ledger-only entry of L-K fixes it.
   *
   * {@link repairStockLedgerGap} already does this automatically when KRA's
   * rejection names both numbers. This is the same repair for the wording
   * that names neither: measure the ledger instead of reading it.
   *
   * `kraLedgerQty` overrides the measurement. It exists because the derivation
   * can legitimately fail (see deriveKraLedgerQty -- the documented
   * StockMoveRes has no `sarTyCd`, so movements may not be signable), and the
   * honest fallback for a number that goes into a tax filing is a human who
   * has read KRA's ledger, not a guess.
   *
   * Idempotent in the way that matters: run it twice and the second run
   * measures a ledger that already agrees, computes a zero gap, and only
   * re-declares `rsdQty`. It is the *adjustment* endpoint that is unsafe to
   * repeat, which is exactly why this is a separate operation.
   */
  async repairKraStockLedger(params: {
    itemId: string;
    branchId: string;
    /** KRA's net for this item, when it can't be derived. Read it off the ledger. */
    kraLedgerQty?: number;
  }): Promise<{
    itemId: string;
    branchId: string;
    itemCd: string | null;
    localQtyOnHand: number;
    kraLedgerQty: number | null;
    /** How the ledger figure was obtained. */
    kraLedgerSource: 'derived' | 'supplied' | 'unavailable';
    gap: number | null;
    ledgerEntry: EtimsPushOutcome;
    stockMaster: EtimsPushOutcome;
  }> {
    const branchId = await this.toCanonicalBranchId(
      params.itemId,
      params.branchId,
    );
    const base = {
      itemId: params.itemId,
      branchId,
      itemCd: null as string | null,
      localQtyOnHand: 0,
      kraLedgerQty: null as number | null,
      kraLedgerSource: 'unavailable' as 'derived' | 'supplied' | 'unavailable',
      gap: null as number | null,
    };

    if (!this.itemRepo || !this.connectionRepo || !this.etimsAdapter) {
      const out = pushSkipped(
        'eTIMS stock sync is not wired up in this context',
      );
      return { ...base, ledgerEntry: out, stockMaster: out };
    }
    if (!this.shouldSyncMovementsToEtims()) {
      const out = pushSkipped(
        'eTIMS stock sync is disabled (ETIMS_STOCK_SYNC) — nothing can be pushed',
      );
      return { ...base, ledgerEntry: out, stockMaster: out };
    }

    const stock = await this.stockRepo.getStock(params.itemId, branchId);
    if (!stock) {
      const out = pushSkipped('No stock recorded for this item/branch');
      return { ...base, ledgerEntry: out, stockMaster: out };
    }
    base.localQtyOnHand = stock.quantityOnHand;

    const [item] = await this.itemRepo.findByIds([params.itemId]);
    if (!item) {
      const out = pushSkipped(`Item ${params.itemId} not found`);
      return { ...base, ledgerEntry: out, stockMaster: out };
    }
    if (deriveItemType(item.productTypeCode) === ItemType.SERVICE) {
      const out = pushSkipped('Services are not stock-tracked by KRA');
      return { ...base, ledgerEntry: out, stockMaster: out };
    }

    const itemCd =
      typeof item.etimsItemCode === 'string' && item.etimsItemCode.trim() !== ''
        ? item.etimsItemCode
        : null;
    if (!itemCd) {
      const out = pushSkipped(
        'Item is not registered with KRA yet (no itemCd) — run Item Sync first',
      );
      return { ...base, ledgerEntry: out, stockMaster: out };
    }
    base.itemCd = itemCd;

    const connection = await this.connectionRepo.findByMerchantAndBranch(
      item.merchantId,
      branchId,
    );
    if (!connection || !connection.kraBhfId) {
      const out = pushSkipped(
        'No initialized eTIMS connection for this branch',
      );
      return { ...base, ledgerEntry: out, stockMaster: out };
    }

    // Resolve KRA's side of the comparison.
    let kraLedgerQty: number;
    if (typeof params.kraLedgerQty === 'number') {
      kraLedgerQty = params.kraLedgerQty;
      base.kraLedgerSource = 'supplied';
    } else {
      const probe = await this.probeKraStockLedger(
        itemCd,
        item.merchantId,
        connection,
      );
      const derived = deriveKraLedgerQty(probe, itemCd);
      if (derived.status === 'unsignable') {
        const out = pushFailed(
          `KRA's ledger for ${itemCd} could not be totalled automatically: ` +
            `${derived.reason}. Read the net off the ledger in this error's ` +
            `detail and pass it as kraLedgerQty.`,
          {
            endpoint: 'selectStockMoveList',
            itemCd,
            branchId: connection.kraBhfId,
            kraStockLedger: probe,
          },
        );
        return { ...base, ledgerEntry: out, stockMaster: out };
      }
      kraLedgerQty = derived.status === 'empty' ? 0 : derived.qty;
      base.kraLedgerSource = 'derived';
    }
    base.kraLedgerQty = kraLedgerQty;

    const gap = round2(stock.quantityOnHand - kraLedgerQty);
    base.gap = gap;

    this.logger.log(
      `eTIMS ledger repair: itemCd=${itemCd} branch=${branchId} ` +
        `local=${stock.quantityOnHand} kraLedger=${kraLedgerQty} ` +
        `(${base.kraLedgerSource}) gap=${gap}`,
    );

    let ledgerEntry: EtimsPushOutcome;
    if (gap === 0) {
      ledgerEntry = pushSkipped(
        "KRA's ledger already matches the local quantity — nothing to correct",
      );
    } else {
      const unitPrice =
        typeof item.unitPrice === 'number' && item.unitPrice > 0
          ? item.unitPrice
          : null;
      if (unitPrice === null) {
        const out = pushSkipped(
          'the item has no unit price, and KRA rejects a zero-amount stock movement',
        );
        return { ...base, ledgerEntry: out, stockMaster: out };
      }
      ledgerEntry = await this.sendStockIo({
        item,
        itemCd,
        connection,
        qty: Math.abs(gap),
        unitPrice,
        // OSCU code classification 12: 05 incoming adjustment, 16 outgoing.
        sarTyCd: gap > 0 ? '05' : '16',
        regTyCd: 'A',
        ocrnDt: this.formatYyyyMMddUtc(new Date()),
        remark: 'RSDQTY_LEDGER_REPAIR',
        logContext: `ledger-repair item=${item.id} branch=${branchId}`,
      });
      if (ledgerEntry.status !== 'ok') {
        // Declaring rsdQty on a ledger we just failed to correct would only
        // reproduce the original rejection.
        return {
          ...base,
          ledgerEntry,
          stockMaster: pushSkipped(
            'not attempted — the ledger correction did not go through',
          ),
        };
      }
    }

    const stockMaster = await this.syncStockMasterToEtims(stock);
    return { ...base, ledgerEntry, stockMaster };
  }

  /**
   * Catches KRA up on stock an item already had locally, right after it
   * registers (saveItem).
   *
   * The stock is there because "Pull from QuickBooks" reconciles the ERP's
   * `qtyOnHand` into the local ledger at pull time -- before the separate
   * Item Sync step registers the item with KRA. At that moment the item has
   * no `itemCd`, so both eTIMS pushes no-op on their own `if (!itemCd)`
   * gate, and item-sync knows nothing about inventory, so nothing re-sends
   * them afterwards. This is the call that closes that gap.
   *
   * It runs the full ledger repair rather than a bare `saveStockMaster`,
   * and that is the whole correctness of it: KRA derives the `rsdQty` it
   * will accept from the item's Stock IO ledger, which for a just-registered
   * item is *empty*. A lone `saveStockMaster` declaring the pulled quantity
   * is therefore guaranteed to be rejected ("rsdQty ... does not match ...
   * from Stock IO") -- which is exactly what this call did, silently, for
   * as long as it has existed. Going through repairKraStockLedger sends the
   * ledger entry the pull could never send, and then declares the quantity.
   *
   * Best-effort and never throws for the caller's sake; the outcome is
   * returned so item-sync can log what actually happened.
   */
  async pushStockMasterCatchUp(
    itemId: string,
    branchId: string,
  ): Promise<Awaited<ReturnType<InventoryService['repairKraStockLedger']>>> {
    return this.repairKraStockLedger({ itemId, branchId });
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
    // Single choke point: adjustStock/reconcileStock/transferStock and
    // SalesService.applyInventoryMovements all reach the stock tables through
    // here, so canonicalizing once covers every writer.
    movementParams.branchId = await this.toCanonicalBranchId(
      params.itemId,
      params.branchId,
    );
    const result = await recordMovement(
      movementParams,
      this.stockRepo,
      this.movementRepo,
    );
    const stockIo = await this.syncStockMovementToEtims({
      ...result,
      unitPrice,
    });
    // saveStockMaster sets KRA's resident-quantity snapshot (rsdQty), not a
    // per-movement ledger entry -- see STOCK_MASTER_SYNC_MOVEMENT_TYPES for
    // which movements are authoritative restatements of on-hand and which
    // KRA already learns about from their own documents.
    //
    // Ordering matters and is not incidental: KRA computes the rsdQty it
    // expects here from the Stock IO ledger the call above just appended to,
    // so the ledger entry has to land first.
    const stockMaster = STOCK_MASTER_SYNC_MOVEMENT_TYPES.includes(
      result.movement.movementType,
    )
      ? await this.syncStockMasterToEtims(result.stock)
      : pushSkipped(
          `KRA derives stock from its own documents for a ${result.movement.movementType} movement`,
        );

    const etims: EtimsStockPushOutcome = { stockIo, stockMaster };
    return { ...result, etims };
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
    // Canonicalize before the read too -- diffing against the wrong row would
    // compute a delta that then gets applied to the right one.
    const branchId = await this.toCanonicalBranchId(
      params.itemId,
      params.branchId,
    );
    const current = await this.stockRepo.getStock(params.itemId, branchId);
    const delta = params.externalQtyOnHand - (current?.quantityOnHand ?? 0);
    return this.recordMovement({
      itemId: params.itemId,
      branchId,
      movementType: MovementType.RECONCILE,
      quantity: delta,
      referenceType: 'RECONCILE',
      referenceId: params.referenceId ?? null,
      sourceSystem: params.sourceSystem ?? 'QUICKBOOKS',
      unitPrice: params.unitPrice,
    });
  }

  /**
   * Current on-hand for one item/branch. Canonicalizes the branch id like
   * every other reader here, so a caller holding either form (Mode A's '00',
   * Mode B's ComplianceBranch.id) gets the row the writers actually maintain.
   * Zero for an item with no row yet -- absence and empty are the same thing
   * to a caller asking "how much is there".
   */
  async getStockLevel(itemId: string, branchId: string) {
    return getStockLevel(
      { itemId, branchId: await this.toCanonicalBranchId(itemId, branchId) },
      this.stockRepo,
    );
  }

  async listStock(branchId?: string) {
    return this.stockRepo.listByBranch(branchId);
  }

  /** Every stock row for one item across all branches -- including any row still keyed by a non-canonical branch id. */
  async listStockForItem(itemId: string) {
    return this.stockRepo.listByItem(itemId);
  }

  async listMovements(params: {
    itemId?: string;
    branchId?: string;
    limit?: number;
  }) {
    return this.movementRepo.list(params);
  }

  /** See IStockMovementRepository.findByReference -- backs re-run safety for
   *  callers that apply a whole document's movements in one go. */
  async listMovementsByReference(referenceType: string, referenceId: string) {
    return this.movementRepo.findByReference(referenceType, referenceId);
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
