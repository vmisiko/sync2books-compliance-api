import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryModule } from './inventory.module';
import { StockController } from './api/stock.controller';
import { InventoryService } from './api/inventory.service';
import { MovementType } from './domain/enums/movement-type.enum';

describe('StockController', () => {
  let controller: StockController;
  let service: InventoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          autoLoadEntities: true,
          synchronize: true,
          logging: false,
        }),
        InventoryModule,
      ],
    }).compile();

    await module.init();

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
});
