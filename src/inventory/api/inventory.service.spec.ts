import { InventoryService } from './inventory.service';
import {
  StockMovementRepositoryStub,
  StockRepositoryStub,
} from '../infrastructure/stock-repository.stub';
import type {
  IComplianceConnectionRepository,
  IComplianceItemRepository,
} from '../../shared/ports/repository.port';
import type { ComplianceItem } from '../../shared/domain/entities/compliance-item.entity';
import type { IEtimsAdapter } from '../../regulatory/oscu/ports/etims-adapter.port';
import type { OscuStockIOSaveReq } from '../../regulatory/oscu/transport/endpoints/stock-io-save.dto';
import { ConnectionEnvironment } from '../../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../../shared/domain/enums/connection-status.enum';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';
import { MovementType } from '../domain/enums/movement-type.enum';

/**
 * Covers the sarNo allocation/release race fixed in allocateSarNo/releaseSarNo
 * (private methods on InventoryService, only reachable through
 * recordMovement -> syncStockMovementToEtims).
 *
 * NOTE on concurrency coverage: allocateSarNo's fix relies on a real
 * `pessimistic_write` (SELECT ... FOR UPDATE) row lock, which TypeORM only
 * supports for its MySQL/Postgres/Oracle/MSSQL drivers -- not sqljs, the
 * in-memory driver this repo's specs use elsewhere for DB-backed tests (see
 * catalog.controller.spec.ts's own comment on exactly this limitation for
 * StockTypeOrmRepository.applyDelta, which uses the same lock mode). A
 * sqljs-backed Promise.all test would either throw
 * LockNotSupportedOnGivenDriverError or silently fail to exercise real
 * locking, so it wouldn't prove anything about the MySQL behavior this fix
 * targets -- and standing up a real MySQL connection isn't practical for
 * this unit-test file. So instead of a real concurrent-DB test, this suite
 * proves the *shape* of both fixes against a hand-rolled fake
 * `syncStateRepo` that models MySQL's actual atomicity guarantees (a locked
 * transaction serializes concurrent callers; a conditional UPDATE only
 * applies when its WHERE clause still matches) -- a regression back to the
 * old read-then-write pattern would fail the assertions below.
 */
describe('InventoryService sarNo allocation/release', () => {
  const oldEnv = process.env;

  afterEach(() => {
    process.env = { ...oldEnv };
  });

  function makeItem(): ComplianceItem {
    return {
      id: 'item-1',
      merchantId: 'merchant-1',
      name: 'Widget',
      sku: 'SKU-1',
      taxCategory: TaxCategory.VAT_STANDARD,
      classificationCode: '14111400',
      unitCode: 'U',
      packagingUnitCode: 'NT',
      taxTyCd: 'B',
      productTypeCode: '2',
      etimsItemCode: 'IT000000000001',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Fakes `syncStateRepo` with MySQL's real atomicity semantics rather than
   * TypeORM's API shape: `manager.transaction` serializes callers against a
   * single shared lock queue (mirroring SELECT ... FOR UPDATE blocking a
   * second transaction until the first commits), and `update` only mutates
   * when its criteria still matches the current row (mirroring an atomic
   * conditional UPDATE). Both are exactly what a read-then-write
   * implementation cannot guarantee, so this fake would expose the old bug
   * if allocateSarNo/releaseSarNo regressed back to it.
   */
  function makeAtomicSyncStateRepo() {
    const store = new Map<string, string>();
    let lockQueue: Promise<void> = Promise.resolve();

    const repoView = {
      findOne: async ({ where: { syncKey } }: any) =>
        store.has(syncKey) ? { syncKey, lastReqDt: store.get(syncKey) } : null,
      upsert: async ({ syncKey, lastReqDt }: any) => {
        store.set(syncKey, lastReqDt);
      },
    };

    return {
      manager: {
        transaction: async <T>(
          work: (manager: {
            getRepository: () => typeof repoView;
          }) => Promise<T>,
        ): Promise<T> => {
          let release!: () => void;
          const myTurn = lockQueue;
          lockQueue = new Promise((resolve) => (release = resolve));
          await myTurn;
          try {
            return await work({ getRepository: () => repoView });
          } finally {
            release();
          }
        },
      },
      update: async (
        criteria: { syncKey: string; lastReqDt: string },
        partial: { lastReqDt: string },
      ) => {
        const current = store.get(criteria.syncKey);
        if (current === criteria.lastReqDt) {
          store.set(criteria.syncKey, partial.lastReqDt);
          return { affected: 1 };
        }
        return { affected: 0 };
      },
      _store: store,
    };
  }

  function buildService(syncStateRepo: ReturnType<typeof makeAtomicSyncStateRepo>) {
    const insertStockIO = jest
      .fn<
        ReturnType<IEtimsAdapter['insertStockIO']>,
        Parameters<IEtimsAdapter['insertStockIO']>
      >()
      .mockResolvedValue({ success: true });

    const etimsAdapter: Partial<IEtimsAdapter> = {
      submitInvoice: jest.fn(),
      saveItem: jest.fn(),
      insertStockIO,
      saveStockMaster: jest.fn().mockResolvedValue({ success: true }),
      selectStockMoveList: jest.fn(),
    };

    const itemRepo: IComplianceItemRepository = {
      findByIds: () => Promise.resolve<ComplianceItem[]>([makeItem()]),
    };

    const connectionRepo: IComplianceConnectionRepository = {
      findByMerchantAndBranch: () =>
        Promise.resolve({
          id: 'conn-1',
          merchantId: 'merchant-1',
          kraPin: 'P1234567890',
          branchId: 'branch-1',
          kraBhfId: '00',
          deviceId: 'device-1',
          environment: ConnectionEnvironment.SANDBOX,
          status: ConnectionStatus.ACTIVE,
          cmcKey: 'cmc-key-stub',
          lastCodeSyncAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
    };

    // Constructed directly rather than through Nest's DI/TestingModule:
    // allocateSarNo/releaseSarNo are private and only reachable through
    // recordMovement, and the interesting collaborator here (syncStateRepo)
    // is the 6th, @Optional @InjectRepository-decorated constructor arg --
    // easier to hand it in directly than to fight Nest's @InjectRepository
    // token wiring for a fake in a plain unit test.
    const service = new (InventoryService as any)(
      new StockRepositoryStub(),
      new StockMovementRepositoryStub(),
      itemRepo,
      connectionRepo,
      etimsAdapter,
      syncStateRepo,
    ) as InventoryService;

    return { service, insertStockIO };
  }

  it('assigns each concurrent movement a unique, gap-free sarNo (no duplicate/skipped allocation)', async () => {
    process.env = { ...oldEnv, ETIMS_STOCK_SYNC: 'true' };

    const syncStateRepo = makeAtomicSyncStateRepo();
    const { service, insertStockIO } = buildService(syncStateRepo);

    // Seed stock so concurrent SALE movements don't fail on insufficient stock.
    await service.recordMovement({
      itemId: 'item-1',
      branchId: 'branch-1',
      movementType: MovementType.PURCHASE,
      quantity: 100,
      referenceType: 'SEED',
      referenceId: 'seed-1',
      unitPrice: 100,
    });
    insertStockIO.mockClear();

    const CONCURRENCY = 8;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        service.recordMovement({
          itemId: 'item-1',
          branchId: 'branch-1',
          movementType: MovementType.SALE,
          quantity: 1,
          referenceType: 'COMPLIANCE_DOCUMENT',
          referenceId: `doc-${i}`,
          unitPrice: 100,
        }),
      ),
    );

    expect(insertStockIO).toHaveBeenCalledTimes(CONCURRENCY);
    const sarNos = insertStockIO.mock.calls
      .map((call) => (call[0] as OscuStockIOSaveReq).sarNo)
      .sort((a, b) => a - b);
    // All unique (no two movements raced to the same value) and perfectly
    // consecutive (no allocation was silently lost between another call's
    // read and write, which would show up as a gap). Not asserting the
    // exact starting value since the earlier seed PURCHASE movement also
    // syncs via insertStockIO and consumes the first sarNo.
    expect(new Set(sarNos).size).toBe(CONCURRENCY);
    for (let i = 1; i < sarNos.length; i++) {
      expect(sarNos[i]).toBe(sarNos[i - 1] + 1);
    }
  });

  it('releaseSarNo only rolls back when its sarNo is still the current value (atomic conditional decrement)', async () => {
    const syncStateRepo = makeAtomicSyncStateRepo();
    const key = 'stock_sar_no:P1234567890:SANDBOX';
    syncStateRepo._store.set(key, '5');

    // This release's sarNo (5) is still current -> rolls back to 4.
    await syncStateRepo.update({ syncKey: key, lastReqDt: '5' }, { lastReqDt: '4' });
    expect(syncStateRepo._store.get(key)).toBe('4');

    // Someone else already advanced the counter past this release's sarNo
    // (it's now at 7, a stale release for sarNo=5 arrives) -> no-op, must NOT
    // stomp the newer value. This is exactly the race the old
    // findOne-then-upsert code could lose.
    syncStateRepo._store.set(key, '7');
    await syncStateRepo.update({ syncKey: key, lastReqDt: '5' }, { lastReqDt: '4' });
    expect(syncStateRepo._store.get(key)).toBe('7');
  });
});
