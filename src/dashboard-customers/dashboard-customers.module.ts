import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { MainApiPullModule } from '../integration/main-api-pull/main-api-pull.module';
import { OscuOperationsModule } from '../regulatory/oscu/presentation/oscu-operations.module';
import { CustomerOrmEntity } from './infrastructure/persistence/customer.orm-entity';
import { DashboardCustomersApplicationService } from './application/dashboard-customers.application.service';
import { DashboardCustomersController } from './presentation/dashboard-customers.controller';

@Module({
  imports: [
    ComplianceOrganizationModule,
    DashboardIdentityModule,
    MainApiPullModule,
    OscuOperationsModule,
    TypeOrmModule.forFeature([CustomerOrmEntity]),
  ],
  controllers: [DashboardCustomersController],
  providers: [DashboardCustomersApplicationService],
  exports: [DashboardCustomersApplicationService],
})
export class DashboardCustomersModule {}
