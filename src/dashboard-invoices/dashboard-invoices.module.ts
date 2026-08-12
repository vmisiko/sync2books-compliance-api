import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { MainApiPullModule } from '../integration/main-api-pull/main-api-pull.module';
import { SalesModule } from '../sales/sales.module';
import { DashboardInvoicesApplicationService } from './application/dashboard-invoices.application.service';
import { DashboardInvoicesController } from './presentation/dashboard-invoices.controller';

@Module({
  imports: [
    CatalogModule,
    ComplianceOrganizationModule,
    DashboardIdentityModule,
    MainApiPullModule,
    SalesModule,
  ],
  controllers: [DashboardInvoicesController],
  providers: [DashboardInvoicesApplicationService],
  exports: [DashboardInvoicesApplicationService],
})
export class DashboardInvoicesModule {}
