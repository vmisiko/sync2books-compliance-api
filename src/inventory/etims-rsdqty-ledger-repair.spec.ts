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
import { ConnectionEnvironment } from '../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../shared/domain/enums/connection-status.enum';
import { TaxCategory } from '../shared/domain/enums/tax-category.enum';
import {
  isRsdQtyLedgerMismatch,
  parseRsdQtyMismatch,
} from '../regulatory/oscu/mapping/oscu-sequence-drift';

const ITEM_CD = 'KE2BFBL0000051';

/**
 * KRA checks `rsdQty` against the running total of the item's Stock IO ledger
 * rather than taking it at face value, so a movement that never reached that
 * ledger strands the item's stock master permanently -- and the symptom lands
 * two steps away, on a sale rejected for "Invalid Item: Item <itemCd> does not
 * exist in your stock master".
 *
 * KRA names both numbers in the rejection ("rsdQty mismatch. Expected: 0.0 but
 * found: 25"), so the difference between them IS the missing ledger entry:
 * send it, and the retry agrees. Same read-it-off-the-rejection repair as the
 * sarNo drift, one step further down the same chain.
 */
describe('InventoryService -- rsdQty ledger repair', () => {
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

    const selectStockMoveList = jest
      .fn<
        ReturnType<IEtimsAdapter['selectStockMoveList']>,
        Parameters<IEtimsAdapter['selectStockMoveList']>
      >()
      .mockResolvedValue({
        success: true,
        rawResponse: {
          resultCd: '000',
          resultMsg: 'Successful',
          resultDt: '20260910013000',
          data: { stockMoveList: [] },
        },
      });

    const etimsAdapter: Partial<IEtimsAdapter> = {
      submitInvoice: jest.fn(),
      saveItem: jest.fn(),
      insertStockIO,
      saveStockMaster,
      selectStockMoveList,
    };

    const itemRepo: IComplianceItemRepository = {
      findByIds: (ids: string[]) =>
        Promise.resolve<ComplianceItem[]>(
          ids.map((id) => ({
            id,
            merchantId: 'merchant-1',
            name: 'Milled Sorghum Flour 2kg Packet',
            sku: 'SKU-51',
            taxCategory: TaxCategory.VAT_STANDARD,
            classificationCode: '14111400',
            unitCode: 'BL',
            packagingUnitCode: 'BF',
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
      selectStockMoveList,
    };
  }

  function withStockSyncOn() {
    process.env = {
      ...oldEnv,
      ETIMS_STOCK_SYNC: 'true',
      ETIMS_STOCK_MASTER_SYNC: 'true',
    };
  }

  describe('parseRsdQtyMismatch', () => {
    it('reads both numbers off the live rejection shape', () => {
      expect(
        parseRsdQtyMismatch('rsdQty mismatch. Expected: 0.0 but found: 150'),
      ).toEqual({ expected: 0, found: 150 });
    });

    // A zero expected value is the common case, not an edge one -- it is what
    // an item whose ledger was never written looks like. `0` must not be read
    // as "no match".
    it('accepts a zero expected value and fractional quantities', () => {
      expect(
        parseRsdQtyMismatch('rsdQty mismatch. Expected: 0.0 but found: 2.5'),
      ).toEqual({ expected: 0, found: 2.5 });
    });

    // The parser doubles as the classifier, so a neighbouring counter's
    // rejection must not be mistaken for this one and "corrected".
    // The wording that reached the dashboard on 2026-09-10. It is the same
    // condition, but names neither number -- which is why the numeric parser
    // has to return null here while the classifier still says yes.
    it('classifies the wording that names no numbers, and parses nothing from it', () => {
      const msg =
        'HTTP 400 calling OSCU: rsdQty quantity provided does not match the ' +
        'KE2BFBL0000051 code from Stock IO';
      expect(isRsdQtyLedgerMismatch(msg)).toBe(true);
      expect(parseRsdQtyMismatch(msg)).toBeNull();
    });

    it('classifies the wording that does name them', () => {
      expect(
        isRsdQtyLedgerMismatch('rsdQty mismatch. Expected: 0.0 but found: 150'),
      ).toBe(true);
    });

    it('does not match a sarNo or invcNo rejection', () => {
      expect(
        isRsdQtyLedgerMismatch('Invalid sarNo: Expected: 10 but found: 15'),
      ).toBe(false);
      expect(
        parseRsdQtyMismatch('Invalid sarNo: Expected: 10 but found: 15'),
      ).toBeNull();
      expect(
        parseRsdQtyMismatch('Invc No: 8 is invalid, use the expected value: 9'),
      ).toBeNull();
      expect(parseRsdQtyMismatch(null)).toBeNull();
    });
  });

  it('sends the missing ledger entry and retries the stock-master push once', async () => {
    withStockSyncOn();
    const { service, insertStockIO, saveStockMaster } = await buildService({
      itemUnitPrice: 120,
    });
    // The state this repairs: local stock exists, KRA's ledger is empty
    // because the movement that created it carried no price.
    saveStockMaster
      .mockResolvedValueOnce({
        success: false,
        error: 'rsdQty mismatch. Expected: 0.0 but found: 25',
      })
      .mockResolvedValueOnce({ success: true });

    const result = await service.adjustStock({
      itemId: 'item-drifted',
      branchId: 'branch-1',
      quantity: 25,
      action: 'ADD',
    });

    expect(saveStockMaster).toHaveBeenCalledTimes(2);
    // Two ledger entries: the adjustment itself, then the repair for the gap
    // KRA reported.
    expect(insertStockIO).toHaveBeenCalledTimes(2);
    const repair = insertStockIO.mock.calls[1][0];
    expect(repair.itemList[0].qty).toBe(25);
    expect(repair.sarTyCd).toBe('05');
    expect(repair.regTyCd).toBe('A');
    expect(repair.remark).toBe('RSDQTY_LEDGER_REPAIR');
    expect(result.etims.stockMaster).toEqual({ status: 'ok' });
  });

  // Outgoing when KRA is *ahead* of us -- the same gap with the opposite sign.
  it('sends an outgoing adjustment when KRA holds more than we declare', async () => {
    withStockSyncOn();
    const { service, insertStockIO, saveStockMaster } = await buildService({
      itemUnitPrice: 120,
    });
    saveStockMaster
      .mockResolvedValueOnce({
        success: false,
        error: 'rsdQty mismatch. Expected: 30 but found: 10',
      })
      .mockResolvedValueOnce({ success: true });

    await service.adjustStock({
      itemId: 'item-kra-ahead',
      branchId: 'branch-1',
      quantity: 10,
      action: 'ADD',
    });

    const repair = insertStockIO.mock.calls[1][0];
    expect(repair.sarTyCd).toBe('16');
    expect(repair.itemList[0].qty).toBe(20);
  });

  // Bounded exactly like the sarNo correction: a rejection that keeps looking
  // like drift must not be able to loop.
  it('gives up after one repair attempt', async () => {
    withStockSyncOn();
    const { service, saveStockMaster } = await buildService({
      itemUnitPrice: 120,
    });
    saveStockMaster.mockResolvedValue({
      success: false,
      error: 'rsdQty mismatch. Expected: 0.0 but found: 25',
    });

    const result = await service.adjustStock({
      itemId: 'item-loop',
      branchId: 'branch-1',
      quantity: 25,
      action: 'ADD',
    });

    expect(saveStockMaster).toHaveBeenCalledTimes(2);
    expect(result.etims.stockMaster.status).toBe('failed');
  });

  /**
   * The live 2026-09-10 failure end to end: KRA rejects, the condition is
   * recognised, but there is no number to correct by. Guessing one would write
   * a wrong quantity into a tax filing, so instead the item's ledger is
   * fetched from KRA and handed back as evidence.
   */
  it("probes KRA's ledger when the rejection names no numbers, and does not guess a correction", async () => {
    withStockSyncOn();
    const { service, insertStockIO, saveStockMaster, selectStockMoveList } =
      await buildService({ itemUnitPrice: 120 });
    saveStockMaster.mockResolvedValue({
      success: false,
      error:
        'HTTP 400 calling OSCU: rsdQty quantity provided does not match the ' +
        'KE2BFBL0000051 code from Stock IO',
    });

    const result = await service.adjustStock({
      itemId: 'item-nonumbers',
      branchId: 'branch-1',
      quantity: 52,
      action: 'ADD',
    });

    // Exactly one insertStockIO: the adjustment. No speculative repair.
    expect(insertStockIO).toHaveBeenCalledTimes(1);
    expect(saveStockMaster).toHaveBeenCalledTimes(1);
    expect(selectStockMoveList).toHaveBeenCalledTimes(1);
    expect(result.etims.stockMaster.status).toBe('failed');
    expect(result.etims.stockMaster.reason).toMatch(/doesn't say by how much/);
    expect(result.etims.stockMaster.detail).toMatchObject({
      endpoint: 'saveStockMaster',
      itemCd: ITEM_CD,
      sent: { rsdQty: 52 },
    });
    expect(result.etims.stockMaster.detail?.kraStockLedger).toBeDefined();
  });

  it('reports the gap it could not close when the item has no price', async () => {
    withStockSyncOn();
    const { service, insertStockIO, saveStockMaster } = await buildService();
    saveStockMaster.mockResolvedValue({
      success: false,
      error: 'rsdQty mismatch. Expected: 0.0 but found: 25',
    });

    const result = await service.adjustStock({
      itemId: 'item-nopricing-drifted',
      branchId: 'branch-1',
      quantity: 25,
      action: 'ADD',
    });

    expect(insertStockIO).toHaveBeenCalledTimes(0);
    expect(saveStockMaster).toHaveBeenCalledTimes(1);
    expect(result.etims.stockMaster.status).toBe('failed');
    expect(result.etims.stockMaster.reason).toMatch(/behind by 25/);
    expect(result.etims.stockMaster.reason).toMatch(/no unit price/i);
  });

  // Anything that is not a ledger gap must still come straight back as a
  // failure -- the repair path is not a general retry.
  it('does not repair a rejection that is not an rsdQty mismatch', async () => {
    withStockSyncOn();
    const { service, insertStockIO, saveStockMaster } = await buildService({
      itemUnitPrice: 120,
    });
    saveStockMaster.mockResolvedValue({
      success: false,
      error: 'Invalid Item: Item KE2BFBL0000051 does not exist',
    });

    const result = await service.adjustStock({
      itemId: 'item-other-error',
      branchId: 'branch-1',
      quantity: 5,
      action: 'ADD',
    });

    expect(saveStockMaster).toHaveBeenCalledTimes(1);
    expect(insertStockIO).toHaveBeenCalledTimes(1); // the adjustment only
    expect(result.etims.stockMaster.status).toBe('failed');
    expect(result.etims.stockMaster.reason).toBe(
      'Invalid Item: Item KE2BFBL0000051 does not exist',
    );
  });
});
