import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceDocumentOrmEntity } from '../sales/infrastructure/persistence/compliance-document.orm-entity';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { MainApiPullModule } from './main-api-pull/main-api-pull.module';
import { PlatformCorrelationModule } from './platform-correlation.module';
import { InvoiceReceiptPushbackService } from './platform-outbound/invoice-receipt-pushback.service';

/**
 * Deliberately a module of its own rather than another provider on
 * `PlatformCorrelationModule`, even though `InvoiceReceiptPushbackService`
 * lives beside that module's providers in `platform-outbound/`: this service
 * needs `MainApiPullModule`, and `CatalogModule` (reachable from it via
 * `DashboardMappingModule`) already imports `PlatformCorrelationModule` --
 * adding the same import there would close that loop and force another
 * `forwardRef()`. Nothing imports this module back, so the edges stay one-way.
 *
 * Imported by both `SalesModule` (the KRA retry path) and
 * `DashboardInvoicesModule` (create-sale-from-invoice + manual upload).
 */
@Module({
  imports: [
    ComplianceOrganizationModule,
    MainApiPullModule,
    PlatformCorrelationModule,
    TypeOrmModule.forFeature([ComplianceDocumentOrmEntity]),
  ],
  providers: [InvoiceReceiptPushbackService],
  exports: [InvoiceReceiptPushbackService],
})
export class InvoiceReceiptPushbackModule {}
