import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MainApiPullModule } from '../integration/main-api-pull/main-api-pull.module';
import { DashboardInventoryApplicationService } from './application/dashboard-inventory.application.service';
import { DashboardInventoryController } from './presentation/dashboard-inventory.controller';

@Module({
  imports: [
    CatalogModule,
    ComplianceOrganizationModule,
    DashboardIdentityModule,
    InventoryModule,
    MainApiPullModule,
  ],
  controllers: [DashboardInventoryController],
  providers: [DashboardInventoryApplicationService],
  exports: [DashboardInventoryApplicationService],
})
export class DashboardInventoryModule {}
