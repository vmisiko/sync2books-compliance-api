import { Module } from '@nestjs/common';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { MainApiPullModule } from '../integration/main-api-pull/main-api-pull.module';
import { OscuMappingModule } from '../regulatory/oscu/oscu-mapping.module';
import { OscuReferenceModule } from '../regulatory/oscu/oscu-reference.module';
import { DashboardMappingApplicationService } from './application/dashboard-mapping.application.service';
import { DashboardMappingsController } from './presentation/dashboard-mappings.controller';

@Module({
  imports: [
    OscuMappingModule,
    OscuReferenceModule,
    ComplianceOrganizationModule,
    DashboardIdentityModule,
    MainApiPullModule,
  ],
  controllers: [DashboardMappingsController],
  providers: [DashboardMappingApplicationService],
  exports: [DashboardMappingApplicationService],
})
export class DashboardMappingModule {}
