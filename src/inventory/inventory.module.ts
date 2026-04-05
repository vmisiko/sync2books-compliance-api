import { Module } from '@nestjs/common';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { InventoryService } from './api/inventory.service';
import { StockController } from './api/stock.controller';
import {
  StockMovementRepositoryStub,
  StockRepositoryStub,
} from './infrastructure/stock-repository.stub';
import { STOCK_MOVEMENT_REPO, STOCK_REPO } from '../shared/tokens';

@Module({
  imports: [ComplianceOrganizationModule],
  controllers: [StockController],
  providers: [
    { provide: STOCK_REPO, useClass: StockRepositoryStub },
    { provide: STOCK_MOVEMENT_REPO, useClass: StockMovementRepositoryStub },
    InventoryService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}
