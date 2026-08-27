import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { OscuOperationsModule } from '../regulatory/oscu/presentation/oscu-operations.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DashboardSuppliersModule } from '../dashboard-suppliers/dashboard-suppliers.module';
import { MainApiPullModule } from '../integration/main-api-pull/main-api-pull.module';
import { OscuSyncStateOrmEntity } from '../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';
import { PurchaseInvoiceOrmEntity } from './infrastructure/persistence/purchase-invoice.orm-entity';
import { DashboardPurchasesApplicationService } from './application/dashboard-purchases.application.service';
import { DashboardPurchasesController } from './presentation/dashboard-purchases.controller';

@Module({
  imports: [
    ComplianceOrganizationModule,
    DashboardIdentityModule,
    OscuOperationsModule,
    CatalogModule,
    DashboardSuppliersModule,
    MainApiPullModule,
    TypeOrmModule.forFeature([
      PurchaseInvoiceOrmEntity,
      OscuSyncStateOrmEntity,
    ]),
  ],
  controllers: [DashboardPurchasesController],
  providers: [DashboardPurchasesApplicationService],
  exports: [DashboardPurchasesApplicationService],
})
export class DashboardPurchasesModule {}
