import { Module } from '@nestjs/common';
import { InventoryService } from './api/inventory.service';
import { InventoryController } from './api/inventory.controller';
import {
  StockMovementRepositoryStub,
  StockRepositoryStub,
} from './infrastructure/stock-repository.stub';
import { STOCK_MOVEMENT_REPO, STOCK_REPO } from '../shared/tokens';

@Module({
  controllers: [InventoryController],
  providers: [
    { provide: STOCK_REPO, useClass: StockRepositoryStub },
    { provide: STOCK_MOVEMENT_REPO, useClass: StockMovementRepositoryStub },
    InventoryService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}
