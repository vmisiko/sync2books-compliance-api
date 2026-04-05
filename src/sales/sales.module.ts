import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { EtimsModule } from '../regulatory/oscu/etims.module';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DOCUMENT_REPO, EVENT_REPO } from '../shared/tokens';
import { ApiSalesController } from './controller/api-sales.controller';
import { DashboardSalesController } from './controller/dashboard-sales.controller';
import { SalesService } from './application/sales.service';
import { ComplianceDocumentOrmEntity } from './infrastructure/persistence/compliance-document.orm-entity';
import { ComplianceLineOrmEntity } from './infrastructure/persistence/compliance-line.orm-entity';
import { ComplianceEventOrmEntity } from './infrastructure/persistence/compliance-event.orm-entity';
import { ComplianceDocumentTypeOrmRepository } from './infrastructure/persistence/compliance-document-typeorm.repository';
import { ComplianceEventTypeOrmRepository } from './infrastructure/persistence/compliance-event-typeorm.repository';

@Module({
  imports: [
    CatalogModule,
    InventoryModule,
    ComplianceOrganizationModule,
    EtimsModule,
    TypeOrmModule.forFeature([
      ComplianceDocumentOrmEntity,
      ComplianceLineOrmEntity,
      ComplianceEventOrmEntity,
    ]),
  ],
  controllers: [ApiSalesController, DashboardSalesController],
  providers: [
    { provide: DOCUMENT_REPO, useClass: ComplianceDocumentTypeOrmRepository },
    { provide: EVENT_REPO, useClass: ComplianceEventTypeOrmRepository },
    SalesService,
  ],
  exports: [SalesService],
})
export class SalesModule {}
