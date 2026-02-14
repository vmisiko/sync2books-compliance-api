import { Test, TestingModule } from '@nestjs/testing';
import { InventoryModule } from './inventory.module';
import { InventoryController } from './api/inventory.controller';
import { InventoryService } from './api/inventory.service';
import { MovementType } from './domain/enums/movement-type.enum';

describe('InventoryController', () => {
  let controller: InventoryController;
  let service: InventoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [InventoryModule],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
    service = module.get<InventoryService>(InventoryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should record movement and get stock level', async () => {
    const record = await service.recordMovement({
      itemId: 'item-1',
      branchId: 'branch-1',
      movementType: MovementType.PURCHASE,
      quantity: 10,
    });
    expect(record.stock.quantityOnHand).toBe(10);

    const level = await service.getStockLevel('item-1', 'branch-1');
    expect(level.quantityOnHand).toBe(10);
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
});
