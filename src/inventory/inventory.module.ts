import { Module } from '@nestjs/common';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { InventoryService } from './api/inventory.service';
import { StockController } from './api/stock.controller';
import {
  StockMovementRepositoryStub,
  StockRepositoryStub,
} from './infrastructure/stock-repository.stub';
import { STOCK_MOVEMENT_REPO, STOCK_REPO } from '../shared/tokens';
import { ComplianceServiceAuthModule } from '../integration/compliance-service-auth.module';
import { PlatformCorrelationModule } from '../integration/platform-correlation.module';

@Module({
  imports: [
    ComplianceOrganizationModule,
    ComplianceServiceAuthModule,
    PlatformCorrelationModule,
  ],
  controllers: [StockController],
  providers: [
    { provide: STOCK_REPO, useClass: StockRepositoryStub },
    { provide: STOCK_MOVEMENT_REPO, useClass: StockMovementRepositoryStub },
    InventoryService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}
