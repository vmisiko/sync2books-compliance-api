import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { MainApiPullModule } from '../integration/main-api-pull/main-api-pull.module';
import { OscuOperationsModule } from '../regulatory/oscu/presentation/oscu-operations.module';
import { SupplierOrmEntity } from './infrastructure/persistence/supplier.orm-entity';
import { DashboardSuppliersApplicationService } from './application/dashboard-suppliers.application.service';
import { DashboardSuppliersController } from './presentation/dashboard-suppliers.controller';

@Module({
  imports: [
    ComplianceOrganizationModule,
    DashboardIdentityModule,
    MainApiPullModule,
    OscuOperationsModule,
    TypeOrmModule.forFeature([SupplierOrmEntity]),
  ],
  controllers: [DashboardSuppliersController],
  providers: [DashboardSuppliersApplicationService],
  exports: [DashboardSuppliersApplicationService],
})
export class DashboardSuppliersModule {}
