import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { ReceiptSettingsService } from './application/receipt-settings.service';
import { ReceiptSettingsOrmEntity } from './infrastructure/receipt-settings.orm-entity';
import { ReceiptSettingsController } from './presentation/receipt-settings.controller';

/**
 * Global on purpose: SalesService resolves receipt settings through an @Optional()
 * injection, so modules that build SalesModule on its own (the sqljs-backed specs,
 * which cannot map this module's longblob logo column) keep working with defaults.
 * Registered once, in AppModule.
 */
@Global()
@Module({
  imports: [
    ComplianceOrganizationModule,
    DashboardIdentityModule,
    TypeOrmModule.forFeature([ReceiptSettingsOrmEntity]),
  ],
  controllers: [ReceiptSettingsController],
  providers: [ReceiptSettingsService],
  exports: [ReceiptSettingsService],
})
export class ReceiptSettingsModule {}
