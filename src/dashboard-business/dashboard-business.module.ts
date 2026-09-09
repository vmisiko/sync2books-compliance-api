import { Module } from '@nestjs/common';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardOrganizationModule } from '../dashboard-organization/dashboard-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { MainApiPullModule } from '../integration/main-api-pull/main-api-pull.module';
import { OscuOperationsModule } from '../regulatory/oscu/presentation/oscu-operations.module';
import { DashboardBranchesApplicationService } from './application/dashboard-branches.application.service';
import { DashboardBranchesController } from './presentation/dashboard-branches.controller';
import { DashboardBusinessController } from './presentation/dashboard-business.controller';
import { DashboardOrganizationSettingsController } from './presentation/dashboard-organization-settings.controller';

@Module({
  imports: [
    ComplianceOrganizationModule,
    DashboardOrganizationModule,
    DashboardIdentityModule,
    MainApiPullModule,
    OscuOperationsModule,
  ],
  controllers: [
    DashboardBusinessController,
    DashboardBranchesController,
    DashboardOrganizationSettingsController,
  ],
  providers: [DashboardBranchesApplicationService],
})
export class DashboardBusinessModule {}
