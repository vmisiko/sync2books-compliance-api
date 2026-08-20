import { Module } from '@nestjs/common';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardOrganizationModule } from '../dashboard-organization/dashboard-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { MainApiPullModule } from '../integration/main-api-pull/main-api-pull.module';
import { DashboardBusinessController } from './presentation/dashboard-business.controller';
import { DashboardOrganizationSettingsController } from './presentation/dashboard-organization-settings.controller';

@Module({
  imports: [
    ComplianceOrganizationModule,
    DashboardOrganizationModule,
    DashboardIdentityModule,
    MainApiPullModule,
  ],
  controllers: [DashboardBusinessController, DashboardOrganizationSettingsController],
})
export class DashboardBusinessModule {}
