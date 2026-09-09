import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './api/inventory.service';
import {
  CONNECTION_REPO,
  ETIMS_ADAPTER,
  ITEM_REPO,
  STOCK_MOVEMENT_REPO,
  STOCK_REPO,
} from '../shared/tokens';
import {
  StockMovementRepositoryStub,
  StockRepositoryStub,
} from './infrastructure/stock-repository.stub';
import type { ComplianceItem } from '../shared/domain/entities/compliance-item.entity';
import type {
  IComplianceConnectionRepository,
  IComplianceItemRepository,
} from '../shared/ports/repository.port';
import type { IEtimsAdapter } from '../regulatory/oscu/ports/etims-adapter.port';
import type { OscuStockMasterSaveReq } from '../regulatory/oscu/transport/endpoints/stock-master-save.dto';
import { ConnectionEnvironment } from '../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../shared/domain/enums/connection-status.enum';
import { TaxCategory } from '../shared/domain/enums/tax-category.enum';
import { MovementType } from './domain/enums/movement-type.enum';

const ITEM_CD = 'KE1AM4B0000011';

/**
 * A manual dashboard adjustment is the only thing that ever gives a
 * manually-created item a quantity, so KRA's resident-quantity snapshot has to
 * follow it. saveStockMaster used to fire on RECONCILE alone, which left a
 * dashboard-adjusted item with stock locally and nothing in KRA's stock master
 * -- reproduced live 2026-09-08 as an HTTP 400 on sendSalesTransaction:
 * "Invalid Item: Item KE1AM4B0000011 (itemSeq 1) does not exist in your stock
 * master", with the item itself registered fine and the itemCd counter in sync.
 */
describe('InventoryService -- saveStockMaster on manual adjustment', () => {
  const oldEnv = process.env;

  afterEach(() => {
    process.env = { ...oldEnv };
  });

  async function buildService(opts: { itemUnitPrice?: number | null } = {}) {
    const insertStockIO = jest
      .fn<
        ReturnType<IEtimsAdapter['insertStockIO']>,
        Parameters<IEtimsAdapter['insertStockIO']>
      >()
      .mockResolvedValue({ success: true });
    const saveStockMaster = jest
      .fn<
        ReturnType<IEtimsAdapter['saveStockMaster']>,
        Parameters<IEtimsAdapter['saveStockMaster']>
      >()
      .mockResolvedValue({ success: true });

    const etimsAdapter: Partial<IEtimsAdapter> = {
      submitInvoice: jest.fn(),
      saveItem: jest.fn(),
      insertStockIO,
      saveStockMaster,
      selectStockMoveList: jest.fn(),
    };

    // Echoes back whichever id was asked for, so each test can use its own
    // itemId -- the stock stubs keep module-level state across tests.
    const itemRepo: IComplianceItemRepository = {
      findByIds: (ids: string[]) =>
        Promise.resolve<ComplianceItem[]>(
          ids.map((id) => ({
            id,
            merchantId: 'merchant-1',
            name: 'Widget',
            sku: 'SKU-1',
            taxCategory: TaxCategory.VAT_STANDARD,
            classificationCode: '14111400',
            unitCode: 'U',
            packagingUnitCode: 'NT',
            taxTyCd: 'B',
            productTypeCode: '2',
            etimsItemCode: ITEM_CD,
            unitPrice: opts.itemUnitPrice ?? null,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        ),
    };

    const connectionRepo: IComplianceConnectionRepository = {
      findByMerchantAndBranch: () =>
        Promise.resolve({
          id: 'conn-1',
          merchantId: 'merchant-1',
          kraPin: 'P600004185A',
          branchId: 'branch-1',
          kraBhfId: '00',
          deviceId: 'device-1',
          sdcId: null,
          mrcNo: null,
          tradeAddressLine1: null,
          tradeCity: null,
          receiptHeaderMessage: null,
          receiptFooterMessage: null,
          environment: ConnectionEnvironment.SANDBOX,
          status: ConnectionStatus.ACTIVE,
          cmcKey: 'cmc-key-stub',
          lastCodeSyncAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      findAnyConnected: () => Promise.resolve(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: STOCK_REPO, useClass: StockRepositoryStub },
        { provide: STOCK_MOVEMENT_REPO, useClass: StockMovementRepositoryStub },
        { provide: ITEM_REPO, useValue: itemRepo },
        { provide: CONNECTION_REPO, useValue: connectionRepo },
        { provide: ETIMS_ADAPTER, useValue: etimsAdapter as IEtimsAdapter },
      ],
    }).compile();

    return {
      service: module.get(InventoryService),
      insertStockIO,
      saveStockMaster,
    };
  }

  it('pushes the new on-hand quantity to KRA after a dashboard ADD adjustment', async () => {
    process.env = {
      ...oldEnv,
      ETIMS_STOCK_SYNC: 'true',
      ETIMS_STOCK_MASTER_SYNC: 'true',
    };
    const { service, saveStockMaster } = await buildService();

    await service.adjustStock({
      itemId: 'item-add',
      branchId: 'branch-1',
      quantity: 10,
      action: 'ADD',
      unitPrice: 100,
    });

    expect(saveStockMaster).toHaveBeenCalledTimes(1);
    const req: OscuStockMasterSaveReq = saveStockMaster.mock.calls[0][0];
    expect(req.itemCd).toBe(ITEM_CD);
    expect(req.rsdQty).toBe(10);
  });

  /**
   * The dashboard's inline stock edit has nowhere to type a price, so the
   * adjustment arrives without one -- and a priceless movement can't be sent
   * as insertStockIO at all (KRA rejects a zero amount). Falling back to the
   * item's own catalog price is what lets that edit reach KRA.
   *
   * This is not a nicety. KRA derives the rsdQty it expects on saveStockMaster
   * from the accumulated Stock IO ledger, so a skipped ledger entry doesn't
   * merely lose an audit row -- it makes the stock-master push that follows
   * fail with "rsdQty mismatch", leaving the item absent from KRA's stock
   * master and every later sale of it rejected for "does not exist in your
   * stock master".
   */
  it("falls back to the item's catalog price when the caller supplies none", async () => {
    process.env = {
      ...oldEnv,
      ETIMS_STOCK_SYNC: 'true',
      ETIMS_STOCK_MASTER_SYNC: 'true',
    };
    const { service, insertStockIO, saveStockMaster } = await buildService({
      itemUnitPrice: 250,
    });

    const result = await service.adjustStock({
      itemId: 'item-catalogprice',
      branchId: 'branch-1',
      quantity: 7,
      action: 'ADD',
    });

    expect(insertStockIO).toHaveBeenCalledTimes(1);
    expect(insertStockIO.mock.calls[0][0].itemList[0].prc).toBe(250);
    expect(saveStockMaster).toHaveBeenCalledTimes(1);
    expect(saveStockMaster.mock.calls[0][0].rsdQty).toBe(7);
    expect(result.etims).toEqual({
      stockIo: { status: 'ok' },
      stockMaster: { status: 'ok' },
    });
  });

  /**
   * With no price anywhere the ledger entry genuinely can't be built. The
   * adjustment still records locally and the stock-master push is still
   * attempted -- but the caller has to be told the ledger half didn't go, or
   * the dashboard reports a flat "Stock adjusted" for a change KRA will
   * reject.
   */
  it('reports the skipped ledger entry when neither the caller nor the item has a price', async () => {
    process.env = {
      ...oldEnv,
      ETIMS_STOCK_SYNC: 'true',
      ETIMS_STOCK_MASTER_SYNC: 'true',
    };
    const { service, insertStockIO, saveStockMaster } = await buildService();

    const result = await service.adjustStock({
      itemId: 'item-nopricing',
      branchId: 'branch-1',
      quantity: 7,
      action: 'ADD',
    });

    expect(insertStockIO).toHaveBeenCalledTimes(0);
    expect(saveStockMaster).toHaveBeenCalledTimes(1);
    expect(saveStockMaster.mock.calls[0][0].rsdQty).toBe(7);
    expect(result.etims.stockIo.status).toBe('skipped');
    expect(result.etims.stockIo.reason).toMatch(/unit price/i);
  });

  /**
   * The pushes are best-effort so a KRA outage never blocks bookkeeping --
   * which is precisely why the rejection has to come back in the result. It
   * used to exist only as a `logger.warn` nobody reads, so the dashboard
   * showed "Stock adjusted" and the failure only surfaced days later as a
   * rejected sale.
   */
  it('reports a KRA rejection back to the caller instead of only logging it', async () => {
    process.env = {
      ...oldEnv,
      ETIMS_STOCK_SYNC: 'true',
      ETIMS_STOCK_MASTER_SYNC: 'true',
    };
    const { service, saveStockMaster } = await buildService({
      itemUnitPrice: 100,
    });
    // A plain rejection, not a ledger mismatch -- the self-healing paths have
    // their own spec (etims-rsdqty-ledger-repair.spec.ts); this one is only
    // about the rejection reaching the caller at all.
    saveStockMaster.mockResolvedValue({
      success: false,
      error: 'OSCU 999 Please try again later',
    });

    const result = await service.adjustStock({
      itemId: 'item-rejected',
      branchId: 'branch-1',
      quantity: 7,
      action: 'ADD',
    });

    expect(result.stock.quantityOnHand).toBe(7);
    expect(result.etims.stockMaster.status).toBe('failed');
    expect(result.etims.stockMaster.reason).toBe(
      'OSCU 999 Please try again later',
    );
    // The evidence rides along, so the dashboard can show what KRA was asked
    // and what it said without anyone tailing the API console.
    expect(result.etims.stockMaster.detail).toMatchObject({
      endpoint: 'saveStockMaster',
      itemCd: ITEM_CD,
      sent: { rsdQty: 7 },
    });
  });

  it('sends the resulting balance rather than the delta on DEDUCT', async () => {
    process.env = { ...oldEnv, ETIMS_STOCK_MASTER_SYNC: 'true' };
    const { service, saveStockMaster } = await buildService();

    await service.adjustStock({
      itemId: 'item-deduct',
      branchId: 'branch-1',
      quantity: 10,
      action: 'ADD',
    });
    saveStockMaster.mockClear();

    await service.adjustStock({
      itemId: 'item-deduct',
      branchId: 'branch-1',
      quantity: 4,
      action: 'DEDUCT',
    });

    expect(saveStockMaster).toHaveBeenCalledTimes(1);
    expect(saveStockMaster.mock.calls[0][0].rsdQty).toBe(6);
  });

  /**
   * The point of keeping this narrow: KRA derives stock from the sales and
   * purchase documents themselves, so restating rsdQty after each one would be
   * both wrong and wasteful. Only ADJUSTMENT and RECONCILE are authoritative.
   */
  it('leaves stock master alone for movements KRA learns from its own documents', async () => {
    process.env = {
      ...oldEnv,
      ETIMS_STOCK_SYNC: 'true',
      ETIMS_STOCK_MASTER_SYNC: 'true',
    };
    const { service, saveStockMaster } = await buildService();

    await service.recordMovement({
      itemId: 'item-sale',
      branchId: 'branch-1',
      movementType: MovementType.PURCHASE,
      quantity: 10,
      referenceType: 'SEED',
      referenceId: 'seed-1',
      unitPrice: 100,
    });
    saveStockMaster.mockClear();

    await service.recordMovement({
      itemId: 'item-sale',
      branchId: 'branch-1',
      movementType: MovementType.SALE,
      quantity: 5,
      referenceType: 'COMPLIANCE_DOCUMENT',
      referenceId: 'doc-1',
      unitPrice: 100,
    });

    expect(saveStockMaster).toHaveBeenCalledTimes(0);
  });

  it('stays off entirely when ETIMS_STOCK_MASTER_SYNC is unset', async () => {
    process.env = { ...oldEnv, ETIMS_STOCK_SYNC: 'true' };
    delete process.env.ETIMS_STOCK_MASTER_SYNC;
    const { service, saveStockMaster } = await buildService();

    await service.adjustStock({
      itemId: 'item-flagoff',
      branchId: 'branch-1',
      quantity: 3,
      action: 'ADD',
      unitPrice: 100,
    });

    expect(saveStockMaster).toHaveBeenCalledTimes(0);
  });
});
