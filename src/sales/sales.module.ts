import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { EtimsAdapterStub } from '../regulatory/oscu/adapters/etims-adapter.stub';
import { EtimsAdapterHttp } from '../regulatory/oscu/adapters/etims-adapter.http';
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
  controllers: [ApiSalesController, DashboardSalesController],
  providers: [
    { provide: DOCUMENT_REPO, useClass: ComplianceDocumentTypeOrmRepository },
    { provide: EVENT_REPO, useClass: ComplianceEventTypeOrmRepository },
    { provide: CONNECTION_REPO, useClass: ConnectionRepositoryStub },
    {
      provide: ETIMS_ADAPTER,
      useFactory: () => {
        const mode = (process.env.ETIMS_ADAPTER_MODE ?? '').toLowerCase();
        const isTest = process.env.NODE_ENV === 'test';
        if (isTest || mode === '' || mode === 'stub') {
          return new EtimsAdapterStub();
        }
        if (mode === 'http')
          return new EtimsAdapterHttp({
            sandboxBaseUrl: process.env.ETIMS_OSCU_SANDBOX_BASE_URL,
            productionBaseUrl: process.env.ETIMS_OSCU_PROD_BASE_URL,
            timeoutMs: process.env.ETIMS_OSCU_TIMEOUT_MS
              ? Number(process.env.ETIMS_OSCU_TIMEOUT_MS)
              : undefined,
          });
        return new EtimsAdapterStub();
      },
    },
    SalesService,
  ],
  exports: [SalesService],
})
export class SalesModule {
  constructor() {
    seedStubData();
  }
}
