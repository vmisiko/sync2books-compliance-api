import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import {
  COMPLIANCE_API_KEY_REPO,
  COMPLIANCE_APPLICATION_REPO,
  RATE_LIMIT_STORE,
} from '../shared/tokens';
import { DeveloperPlatformApplicationService } from './application/developer-platform.application.service';
import { ApiRateLimitGuard } from './infrastructure/guards/api-rate-limit.guard';
import { ComplianceApiKeyGuard } from './infrastructure/guards/compliance-api-key.guard';
import { TenantScopeGuard } from './infrastructure/guards/tenant-scope.guard';
import { ComplianceApiKeyOrmEntity } from './infrastructure/persistence/compliance-api-key.orm-entity';
import { ComplianceApiKeyTypeOrmRepository } from './infrastructure/persistence/compliance-api-key.typeorm.repository';
import { ComplianceApplicationOrmEntity } from './infrastructure/persistence/compliance-application.orm-entity';
import { ComplianceApplicationTypeOrmRepository } from './infrastructure/persistence/compliance-application.typeorm.repository';
import { createRateLimitStore } from './infrastructure/rate-limit/rate-limit-store.factory';
import { DeveloperPlatformController } from './presentation/developer-platform.controller';
import { V1BusinessesController } from './presentation/v1/v1-businesses.controller';
import { V1MeController } from './presentation/v1/v1-me.controller';

/**
 * The self-serve API platform: a merchant organisation's own integration
 * applications, the API keys they issue, and the three guards every public
 * `/v1` route is mounted behind.
 *
 * Exports the guards rather than applying them globally — a guard that runs
 * everywhere would have to decide per-route whether it applies, which is the
 * shape that let dashboard routes drift out of scope in the first place.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ComplianceApplicationOrmEntity,
      ComplianceApiKeyOrmEntity,
    ]),
    ComplianceOrganizationModule,
    DashboardIdentityModule,
  ],
  controllers: [
    DeveloperPlatformController,
    V1MeController,
    V1BusinessesController,
  ],
  providers: [
    ComplianceApplicationTypeOrmRepository,
    {
      provide: COMPLIANCE_APPLICATION_REPO,
      useExisting: ComplianceApplicationTypeOrmRepository,
    },
    ComplianceApiKeyTypeOrmRepository,
    {
      provide: COMPLIANCE_API_KEY_REPO,
      useExisting: ComplianceApiKeyTypeOrmRepository,
    },
    { provide: RATE_LIMIT_STORE, useFactory: createRateLimitStore },
    DeveloperPlatformApplicationService,
    ComplianceApiKeyGuard,
    TenantScopeGuard,
    ApiRateLimitGuard,
  ],
  exports: [
    COMPLIANCE_APPLICATION_REPO,
    COMPLIANCE_API_KEY_REPO,
    RATE_LIMIT_STORE,
    DeveloperPlatformApplicationService,
    ComplianceApiKeyGuard,
    TenantScopeGuard,
    ApiRateLimitGuard,
  ],
})
export class DeveloperPlatformModule {}
