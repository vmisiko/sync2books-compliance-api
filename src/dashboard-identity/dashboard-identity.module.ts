import { Module, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DASHBOARD_USER_REPO } from '../shared/tokens';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardOrganizationModule } from '../dashboard-organization/dashboard-organization.module';
import { DashboardAuthApplicationService } from './application/dashboard-auth.application.service';
import { dashboardJwtSecret } from './infrastructure/dashboard-jwt.secret';
import { DashboardJwtAuthGuard } from './infrastructure/guards/dashboard-jwt-auth.guard';
import { ActiveTenantGuard } from './infrastructure/guards/active-tenant.guard';
import {
  GoogleOAuthConfiguredGuard,
  MicrosoftOAuthConfiguredGuard,
} from './infrastructure/guards/oauth-configured.guard';
import { DashboardUserOrmEntity } from './infrastructure/persistence/dashboard-user.orm-entity';
import { DashboardUserSeed } from './infrastructure/persistence/dashboard-user.seed';
import { DashboardUserTypeOrmRepository } from './infrastructure/persistence/dashboard-user.typeorm.repository';
import { DashboardJwtStrategy } from './infrastructure/strategies/dashboard-jwt.strategy';
import { GoogleOAuthStrategy } from './infrastructure/strategies/google-oauth.strategy';
import { MicrosoftOAuthStrategy } from './infrastructure/strategies/microsoft-oauth.strategy';
import { DashboardAuthController } from './presentation/dashboard-auth.controller';

@Module({
  imports: [
    ComplianceOrganizationModule,
    DashboardOrganizationModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: dashboardJwtSecret(),
        signOptions: { expiresIn: '1h' },
      }),
    }),
    TypeOrmModule.forFeature([DashboardUserOrmEntity]),
  ],
  controllers: [DashboardAuthController],
  providers: [
    DashboardUserTypeOrmRepository,
    {
      provide: DASHBOARD_USER_REPO,
      useExisting: DashboardUserTypeOrmRepository,
    },
    DashboardAuthApplicationService,
    DashboardJwtStrategy,
    GoogleOAuthStrategy,
    MicrosoftOAuthStrategy,
    DashboardJwtAuthGuard,
    GoogleOAuthConfiguredGuard,
    MicrosoftOAuthConfiguredGuard,
    ActiveTenantGuard,
    DashboardUserSeed,
  ],
  exports: [
    DashboardJwtAuthGuard,
    ActiveTenantGuard,
    DASHBOARD_USER_REPO,
    DashboardAuthApplicationService,
  ],
})
export class DashboardIdentityModule implements OnModuleInit {
  constructor(private readonly seed: DashboardUserSeed) {}

  async onModuleInit(): Promise<void> {
    await this.seed.runIfEmpty();
  }
}
