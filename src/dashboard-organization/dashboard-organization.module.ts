import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DASHBOARD_ORGANIZATION_REPO } from '../shared/tokens';
import { DashboardOrganizationApplicationService } from './application/dashboard-organization.application.service';
import { DashboardOrganizationOrmEntity } from './infrastructure/persistence/dashboard-organization.orm-entity';
import { DashboardOrganizationTypeOrmRepository } from './infrastructure/persistence/dashboard-organization.typeorm.repository';

/**
 * Deliberately imports neither DashboardIdentityModule nor MainApiPullModule
 * (avoids the circular import — DashboardIdentityModule imports *this*
 * module for signup).
 */
@Module({
  imports: [TypeOrmModule.forFeature([DashboardOrganizationOrmEntity])],
  providers: [
    DashboardOrganizationTypeOrmRepository,
    {
      provide: DASHBOARD_ORGANIZATION_REPO,
      useExisting: DashboardOrganizationTypeOrmRepository,
    },
    DashboardOrganizationApplicationService,
  ],
  exports: [
    DASHBOARD_ORGANIZATION_REPO,
    DashboardOrganizationApplicationService,
  ],
})
export class DashboardOrganizationModule {}
