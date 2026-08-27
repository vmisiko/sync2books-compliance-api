import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { MainApiPullModule } from '../integration/main-api-pull/main-api-pull.module';
import { OscuMappingModule } from '../regulatory/oscu/oscu-mapping.module';
import { DashboardItemsApplicationService } from './application/dashboard-items.application.service';
import { DashboardItemsController } from './presentation/dashboard-items.controller';

@Module({
  imports: [
    CatalogModule,
    ComplianceOrganizationModule,
    DashboardIdentityModule,
    MainApiPullModule,
    OscuMappingModule,
  ],
  controllers: [DashboardItemsController],
  providers: [DashboardItemsApplicationService],
  exports: [DashboardItemsApplicationService],
})
export class DashboardCatalogModule {}
