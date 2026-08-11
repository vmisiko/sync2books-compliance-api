import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { CatalogModule } from '../catalog/catalog.module';
import { EtimsModule } from '../regulatory/oscu/etims.module';
import { OscuSyncStateOrmEntity } from '../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';

@Module({
  imports: [
    ComplianceOrganizationModule,
    ComplianceServiceAuthModule,
    PlatformCorrelationModule,
    // ITEM_REPO and ETIMS_ADAPTER -- InventoryService's optional deps for
    // syncStockMovementToEtims/syncStockMasterToEtims (ETIMS_STOCK_SYNC /
    // ETIMS_STOCK_MASTER_SYNC) were silently undefined without these, so the
    // whole eTIMS stock-sync feature was a no-op regardless of env flags.
    CatalogModule,
    EtimsModule,
    TypeOrmModule.forFeature([OscuSyncStateOrmEntity]),
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
