import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './api/inventory.service';
import { STOCK_MOVEMENT_REPO, STOCK_REPO } from '../shared/tokens';
import {
  StockMovementRepositoryStub,
  StockRepositoryStub,
} from './infrastructure/stock-repository.stub';
import { ITEM_REPO, CONNECTION_REPO, ETIMS_ADAPTER } from '../shared/tokens';
import type { ComplianceItem } from '../shared/domain/entities/compliance-item.entity';
import type {
  IComplianceConnectionRepository,
  IComplianceItemRepository,
} from '../shared/ports/repository.port';
import type { IEtimsAdapter } from '../regulatory/oscu/ports/etims-adapter.port';
import type { OscuStockIOSaveReq } from '../regulatory/oscu/transport/endpoints/stock-io-save.dto';
import { ConnectionEnvironment } from '../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../shared/domain/enums/connection-status.enum';
import { ItemType } from '../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../shared/domain/enums/tax-category.enum';
import { MovementType } from './domain/enums/movement-type.enum';

describe('InventoryService eTIMS stock sync', () => {
  const oldEnv = process.env;

  afterEach(() => {
    process.env = { ...oldEnv };
  });

  it('syncs movement via insertStockIO when ETIMS_STOCK_SYNC=true', async () => {
    process.env = { ...oldEnv, ETIMS_STOCK_SYNC: 'true' };

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

    const itemRepo: IComplianceItemRepository = {
      findByIds: () =>
        Promise.resolve<ComplianceItem[]>([
          {
            id: 'item-1',
            merchantId: 'merchant-1',
            name: 'Widget',
            sku: 'SKU-1',
            itemType: ItemType.GOODS,
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
          },
        ]),
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

    const service = module.get(InventoryService);

    // Seed stock first so SALE doesn't fail.
    await service.recordMovement({
      itemId: 'item-1',
      branchId: 'branch-1',
      movementType: MovementType.PURCHASE,
      quantity: 10,
      referenceType: 'SEED',
      referenceId: 'seed-1',
    });

    insertStockIO.mockClear();
    saveStockMaster.mockClear();

    await service.recordMovement({
      itemId: 'item-1',
      branchId: 'branch-1',
      movementType: MovementType.SALE,
      quantity: 5,
      referenceType: 'COMPLIANCE_DOCUMENT',
      referenceId: 'doc-1',
    });

    expect(insertStockIO).toHaveBeenCalledTimes(1);
    const req: OscuStockIOSaveReq = insertStockIO.mock.calls[0][0];
    expect(req.sarTyCd).toBe('11'); // sale
    expect(req.itemList[0].qty).toBe(5); // absolute
    expect(req.itemList[0].itemCd).toBe('IT000000000001');

    // saveStockMaster is reconciliation-only now.
    expect(saveStockMaster).toHaveBeenCalledTimes(0);
  });
});
