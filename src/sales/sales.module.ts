import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { EtimsAdapterStub } from '../regulatory/oscu/adapters/etims-adapter.stub';
import {
  ConnectionRepositoryStub,
  seedStubData,
} from './infrastructure/persistence/repository.stub';
import {
  CONNECTION_REPO,
  DOCUMENT_REPO,
  ETIMS_ADAPTER,
  EVENT_REPO,
} from '../shared/tokens';
import { ApiSalesController } from './controller/api-sales.controller';
import { DashboardSalesController } from './controller/dashboard-sales.controller';
import { DocumentsController } from './controller/documents.controller';
import { SalesService } from './application/sales.service';
import { ComplianceDocumentOrmEntity } from './infrastructure/persistence/compliance-document.orm-entity';
import { ComplianceLineOrmEntity } from './infrastructure/persistence/compliance-line.orm-entity';
import { ComplianceEventOrmEntity } from './infrastructure/persistence/compliance-event.orm-entity';
import { ComplianceDocumentTypeOrmRepository } from './infrastructure/persistence/compliance-document-typeorm.repository';
import { ComplianceEventTypeOrmRepository } from './infrastructure/persistence/compliance-event-typeorm.repository';

@Module({
  imports: [
    CatalogModule,
    TypeOrmModule.forFeature([
      ComplianceDocumentOrmEntity,
      ComplianceLineOrmEntity,
      ComplianceEventOrmEntity,
    ]),
  ],
  controllers: [
    DocumentsController,
    ApiSalesController,
    DashboardSalesController,
  ],
  providers: [
    { provide: DOCUMENT_REPO, useClass: ComplianceDocumentTypeOrmRepository },
    { provide: EVENT_REPO, useClass: ComplianceEventTypeOrmRepository },
    { provide: CONNECTION_REPO, useClass: ConnectionRepositoryStub },
    { provide: ETIMS_ADAPTER, useClass: EtimsAdapterStub },
    SalesService,
  ],
  exports: [SalesService],
})
export class SalesModule {
  constructor() {
    seedStubData();
  }
}
