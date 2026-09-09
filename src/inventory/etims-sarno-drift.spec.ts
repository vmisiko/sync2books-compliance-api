import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryService } from './api/inventory.service';
import { parseExpectedSarNo } from '../regulatory/oscu/mapping/oscu-sequence-drift';
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
import { OscuSyncStateOrmEntity } from '../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';
import type { ComplianceItem } from '../shared/domain/entities/compliance-item.entity';
import type {
  IComplianceConnectionRepository,
  IComplianceItemRepository,
} from '../shared/ports/repository.port';
import type { IEtimsAdapter } from '../regulatory/oscu/ports/etims-adapter.port';
import { ConnectionEnvironment } from '../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../shared/domain/enums/connection-status.enum';
import { TaxCategory } from '../shared/domain/enums/tax-category.enum';

const ITEM_CD = 'KE2BAAV0000020';
const SYNC_KEY = 'stock_sar_no:P600004185A:SANDBOX';

/** Verbatim rejection captured live 2026-09-09 against the KRA sandbox. */
const LIVE_DRIFT_ERROR =
  'HTTP 400 calling OSCU: Invalid sarNo: Expected: 10 but found: 15';

describe('parseExpectedSarNo', () => {
  it('reads the expected value out of the live rejection shape', () => {
    expect(parseExpectedSarNo(LIVE_DRIFT_ERROR)).toBe(10);
  });

  it('is case- and spacing-tolerant', () => {
    expect(parseExpectedSarNo('invalid sarno:expected:7 but found:9')).toBe(7);
  });

  it('returns null for anything that is not a sarNo drift rejection', () => {
    expect(parseExpectedSarNo(null)).toBeNull();
    expect(parseExpectedSarNo(undefined)).toBeNull();
    expect(parseExpectedSarNo('')).toBeNull();
    // Must not be confused with the itemCd sequence rejection.
    expect(parseExpectedSarNo('Invalid itemCd: sequence reused')).toBeNull();
    expect(
      parseExpectedSarNo('rsdQty mismatch. Expected: 0.0 but found: 150'),
    ).toBeNull();
  });
});

/**
 * KRA validates sarNo as strictly last-accepted + 1 per tin, and the sandbox
 * PIN is shared across databases, so another system can consume values this one
 * never sees -- the counter then sits ahead of KRA and every insertStockIO is
 * rejected. Confirmed live 2026-09-09: a local counter of 15 against KRA's
 * expected 10 rejected every movement, which left KRA's Stock IO ledger empty,
 * which in turn made saveStockMaster fail with "rsdQty mismatch. Expected: 0.0"
 * and surfaced to the user as a sale rejected for "does not exist in your stock
 * master". Unlike itemCd, KRA names the expected value in the rejection, so the
 * repair needs no probe call.
 */
describe('InventoryService -- sarNo drift self-heal', () => {
  const oldEnv = process.env;

  afterEach(() => {
    process.env = { ...oldEnv };
  });

  /** Minimal in-memory stand-in for Repository<OscuSyncStateOrmEntity>. */
  function makeSyncStateRepo(initial: number) {
    const rows = new Map<string, string>([[SYNC_KEY, String(initial)]]);
    const inner = {
      findOne: ({ where }: { where: { syncKey: string } }) =>
        Promise.resolve(
          rows.has(where.syncKey)
            ? { syncKey: where.syncKey, lastReqDt: rows.get(where.syncKey) }
            : null,
        ),
      upsert: (v: { syncKey: string; lastReqDt: string }) => {
        rows.set(v.syncKey, v.lastReqDt);
        return Promise.resolve(undefined);
      },
    };
    return {
      rows,
      repo: {
        manager: {
          transaction: (cb: (m: unknown) => Promise<number>) =>
            cb({ getRepository: () => inner }),
        },
        upsert: inner.upsert,
        update: (
          where: { syncKey: string; lastReqDt: string },
          set: { lastReqDt: string },
        ) => {
          // Mirrors the real conditional UPDATE: only rolls back when the
          // counter is still the value this attempt allocated.
          if (rows.get(where.syncKey) === where.lastReqDt) {
            rows.set(where.syncKey, set.lastReqDt);
          }
          return Promise.resolve(undefined);
        },
      },
    };
  }

  async function buildService(
    initialCounter: number,
    insertStockIO: jest.Mock,
  ) {
    const state = makeSyncStateRepo(initialCounter);

    const etimsAdapter: Partial<IEtimsAdapter> = {
      submitInvoice: jest.fn(),
      saveItem: jest.fn(),
      insertStockIO: insertStockIO as unknown as IEtimsAdapter['insertStockIO'],
      saveStockMaster: jest.fn().mockResolvedValue({ success: true }),
      selectStockMoveList: jest.fn(),
    };

    const itemRepo: IComplianceItemRepository = {
      findByIds: (ids: string[]) =>
        Promise.resolve<ComplianceItem[]>(
          ids.map((id) => ({
            id,
            merchantId: 'merchant-1',
            name: 'vehicle parts',
            sku: null,
            taxCategory: TaxCategory.VAT_STANDARD,
            classificationCode: '1010151200',
            unitCode: 'AV',
            packagingUnitCode: 'BA',
            taxTyCd: 'D',
            productTypeCode: '2',
            etimsItemCode: ITEM_CD,
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
        {
          provide: getRepositoryToken(OscuSyncStateOrmEntity),
          useValue: state.repo,
        },
      ],
    }).compile();

    return { service: module.get(InventoryService), state };
  }

  it('corrects the counter from KRA’s rejection and retries once with the expected sarNo', async () => {
    process.env = { ...oldEnv, ETIMS_STOCK_SYNC: 'true' };
    delete process.env.ETIMS_STOCK_MASTER_SYNC;

    const insertStockIO = jest
      .fn()
      .mockResolvedValueOnce({ success: false, error: LIVE_DRIFT_ERROR })
      .mockResolvedValueOnce({ success: true });

    // Counter at 14 -> first allocation is 15, exactly the live scenario.
    const { service, state } = await buildService(14, insertStockIO);

    await service.adjustStock({
      itemId: 'item-drift',
      branchId: 'branch-1',
      quantity: 5,
      action: 'ADD',
      unitPrice: 900,
    });

    expect(insertStockIO).toHaveBeenCalledTimes(2);
    expect(insertStockIO.mock.calls[0][0].sarNo).toBe(15);
    expect(insertStockIO.mock.calls[1][0].sarNo).toBe(10);

    // Counter reflects the accepted value, NOT rolled back: releasing here
    // would decrement the correction and strand it one behind again.
    expect(state.rows.get(SYNC_KEY)).toBe('10');
  });

  it('gives up after a single correction so a look-alike rejection cannot loop', async () => {
    process.env = { ...oldEnv, ETIMS_STOCK_SYNC: 'true' };

    const insertStockIO = jest
      .fn()
      .mockResolvedValue({ success: false, error: LIVE_DRIFT_ERROR });

    const { service } = await buildService(14, insertStockIO);

    await service.adjustStock({
      itemId: 'item-loop',
      branchId: 'branch-1',
      quantity: 1,
      action: 'ADD',
      unitPrice: 900,
    });

    expect(insertStockIO).toHaveBeenCalledTimes(2);
  });

  it('still rolls the counter back on a rejection that is not sarNo drift', async () => {
    process.env = { ...oldEnv, ETIMS_STOCK_SYNC: 'true' };

    const insertStockIO = jest.fn().mockResolvedValue({
      success: false,
      error: 'HTTP 400 calling OSCU: Invalid pkg for ItemList 1',
    });

    const { service, state } = await buildService(14, insertStockIO);

    await service.adjustStock({
      itemId: 'item-other',
      branchId: 'branch-1',
      quantity: 1,
      action: 'ADD',
      unitPrice: 900,
    });

    expect(insertStockIO).toHaveBeenCalledTimes(1);
    expect(state.rows.get(SYNC_KEY)).toBe('14');
  });
});
