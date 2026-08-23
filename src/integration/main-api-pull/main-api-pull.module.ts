import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MAIN_API_CONNECTION_REPO } from '../../shared/tokens';
import { DashboardIdentityModule } from '../../dashboard-identity/dashboard-identity.module';
import { ComplianceOrganizationModule } from '../../compliance-organization/compliance-organization.module';
import { DashboardMappingModule } from '../../dashboard-mapping/dashboard-mapping.module';
import { MainApiConnectionApplicationService } from './application/main-api-connection.application.service';
import { MainApiPullClient } from './infrastructure/http/main-api-pull.client';
import { MainApiConnectionOrmEntity } from './infrastructure/persistence/main-api-connection.orm-entity';
import { MainApiConnectionTypeOrmRepository } from './infrastructure/persistence/main-api-connection.typeorm.repository';
import { MainApiConnectionController } from './presentation/main-api-connection.controller';
import { ErpLinkController } from './presentation/erp-link.controller';
import { MainApiWebhookController } from './presentation/main-api-webhook.controller';

@Module({
  imports: [
    DashboardIdentityModule,
    ComplianceOrganizationModule,
    TypeOrmModule.forFeature([MainApiConnectionOrmEntity]),
    // MainApiWebhookController auto-triggers a Mapping Center pull after a
    // connection.connected webhook -- DashboardMappingModule already imports
    // this module (for MainApiConnectionApplicationService/MainApiPullClient),
    // so this back-edge needs forwardRef() to break the cycle, same pattern
    // as CatalogModule <-> InventoryModule.
    forwardRef(() => DashboardMappingModule),
  ],
  controllers: [
    MainApiConnectionController,
    ErpLinkController,
    MainApiWebhookController,
  ],
  providers: [
    MainApiConnectionTypeOrmRepository,
    {
      provide: MAIN_API_CONNECTION_REPO,
      useExisting: MainApiConnectionTypeOrmRepository,
    },
    MainApiConnectionApplicationService,
    MainApiPullClient,
  ],
  exports: [
    MAIN_API_CONNECTION_REPO,
    MainApiConnectionApplicationService,
    MainApiPullClient,
  ],
})
export class MainApiPullModule {}
