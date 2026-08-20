import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { OscuOperationsModule } from '../regulatory/oscu/presentation/oscu-operations.module';
import { PurchaseInvoiceOrmEntity } from './infrastructure/persistence/purchase-invoice.orm-entity';
import { DashboardPurchasesApplicationService } from './application/dashboard-purchases.application.service';
import { DashboardPurchasesController } from './presentation/dashboard-purchases.controller';

@Module({
  imports: [
    ComplianceOrganizationModule,
    DashboardIdentityModule,
    OscuOperationsModule,
    TypeOrmModule.forFeature([PurchaseInvoiceOrmEntity]),
  ],
  controllers: [DashboardPurchasesController],
  providers: [DashboardPurchasesApplicationService],
  exports: [DashboardPurchasesApplicationService],
})
export class DashboardPurchasesModule {}
