import { Test, TestingModule } from '@nestjs/testing';
import { StockController } from './api/stock.controller';
import { InventoryService } from './api/inventory.service';
import { MovementType } from './domain/enums/movement-type.enum';
import {
  StockMovementRepositoryStub,
  StockRepositoryStub,
} from './infrastructure/stock-repository.stub';
import { STOCK_MOVEMENT_REPO, STOCK_REPO } from '../shared/tokens';
import { PlatformOscuCallbackService } from '../integration/platform-outbound/platform-oscu-callback.service';

describe('StockController', () => {
  let controller: StockController;
  let service: InventoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StockController],
      providers: [
        { provide: STOCK_REPO, useClass: StockRepositoryStub },
        { provide: STOCK_MOVEMENT_REPO, useClass: StockMovementRepositoryStub },
        InventoryService,
        {
          provide: PlatformOscuCallbackService,
          useValue: {
            emitStockOutcome: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get<StockController>(StockController);
    service = module.get<InventoryService>(InventoryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should adjust stock (ADD then DEDUCT)', async () => {
    const add = await controller.adjustStock({
      itemId: 'item-1',
      branchId: 'branch-1',
      quantity: 10,
      action: 'ADD',
      movementTypeCode: '05',
    });
    expect(add.stock.quantityOnHand).toBe(10);

    const deduct = await controller.adjustStock({
      itemId: 'item-1',
      branchId: 'branch-1',
      quantity: 4,
      action: 'DEDUCT',
      movementTypeCode: '11',
    });
    expect(deduct.stock.quantityOnHand).toBe(6);
  });

  it('should reject sale when insufficient stock', async () => {
    await service.recordMovement({
      itemId: 'item-2',
      branchId: 'branch-1',
      movementType: MovementType.PURCHASE,
      quantity: 5,
    });

    await expect(
      service.recordMovement({
        itemId: 'item-2',
        branchId: 'branch-1',
        movementType: MovementType.SALE,
        quantity: 10,
      }),
    ).rejects.toThrow('Insufficient stock');
  });

  it('should transfer stock between branches', async () => {
    await service.recordMovement({
      itemId: 'item-3',
      branchId: 'branch-a',
      movementType: MovementType.PURCHASE,
      quantity: 7,
    });

    const res = await controller.transferStock({
      itemId: 'item-3',
      fromBranchId: 'branch-a',
      receivingItemId: 'item-3',
      toBranchId: 'branch-b',
      quantity: 5,
      referenceId: 'xfer-1',
    });

    expect(res.from.quantityOnHand).toBe(2);
    expect(res.to.quantityOnHand).toBe(5);
  });

  it('should reconcile stock against an external quantity, recording the delta not the absolute value', async () => {
    await service.recordMovement({
      itemId: 'item-4',
      branchId: 'branch-1',
      movementType: MovementType.PURCHASE,
      quantity: 10,
    });

    const up = await service.reconcileStock({
      itemId: 'item-4',
      branchId: 'branch-1',
      externalQtyOnHand: 15,
    });
    expect(up.movement.movementType).toBe(MovementType.RECONCILE);
    expect(up.movement.quantity).toBe(5); // 15 - 10
    expect(up.movement.sourceSystem).toBe('QUICKBOOKS');
    expect(up.stock.quantityOnHand).toBe(15);

    const down = await service.reconcileStock({
      itemId: 'item-4',
      branchId: 'branch-1',
      externalQtyOnHand: 3,
    });
    expect(down.movement.quantity).toBe(-12); // 3 - 15
    expect(down.stock.quantityOnHand).toBe(3);
  });

  it('should reject a movement that would take stock negative without recording it', async () => {
    await service.recordMovement({
      itemId: 'item-5',
      branchId: 'branch-1',
      movementType: MovementType.PURCHASE,
      quantity: 2,
    });

    await expect(
      service.recordMovement({
        itemId: 'item-5',
        branchId: 'branch-1',
        movementType: MovementType.SALE,
        quantity: 5,
      }),
    ).rejects.toThrow('Insufficient stock');

    const movements = await service.listMovements({ itemId: 'item-5' });
    // Only the PURCHASE should be recorded -- the rejected SALE must never
    // land in the ledger (a real pre-existing bug this atomicity fix closes).
    expect(movements).toHaveLength(1);
    expect(movements[0].movementType).toBe(MovementType.PURCHASE);
  });
});
