import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DASHBOARD_ORGANIZATION_REPO } from '../shared/tokens';
import { DashboardOrganizationApplicationService } from './application/dashboard-organization.application.service';
import { MainApiAuthClient } from './infrastructure/http/main-api-auth.client';
import { DashboardOrganizationOrmEntity } from './infrastructure/persistence/dashboard-organization.orm-entity';
import { DashboardOrganizationTypeOrmRepository } from './infrastructure/persistence/dashboard-organization.typeorm.repository';

/**
 * Deliberately imports neither DashboardIdentityModule nor MainApiPullModule
 * (avoids the circular import — DashboardIdentityModule imports *this*
 * module for signup). Its main-API calls are unauthenticated self-serve
 * signup/application-creation, via its own MainApiAuthClient — not
 * MainApiPullClient, which is entirely apiKey-authenticated partner calls.
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
    MainApiAuthClient,
  ],
  exports: [
    DASHBOARD_ORGANIZATION_REPO,
    DashboardOrganizationApplicationService,
  ],
})
export class DashboardOrganizationModule {}
