import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CatalogModule } from './catalog/catalog.module';
import { ComplianceOrganizationModule } from './compliance-organization/compliance-organization.module';
import { InventoryModule } from './inventory/inventory.module';
import { OscuMappingModule } from './regulatory/oscu/oscu-mapping.module';
import { OscuReferenceModule } from './regulatory/oscu/oscu-reference.module';
import { SalesModule } from './sales/sales.module';
import { CatalogItemOrmEntity } from './catalog/infrastructure/persistence/catalog-item.orm-entity';
import { ComplianceBranchOrmEntity } from './compliance-organization/infrastructure/persistence/compliance-branch.orm-entity';
import { ComplianceEtimsConnectionOrmEntity } from './compliance-organization/infrastructure/persistence/compliance-etims-connection.orm-entity';
import { ComplianceTenantOrmEntity } from './compliance-organization/infrastructure/persistence/compliance-tenant.orm-entity';
import { ClassificationMappingOrmEntity } from './regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';
import { OscuCodeClassOrmEntity } from './regulatory/oscu/infrastructure/persistence/oscu-code-class.orm-entity';
import { OscuCodeOrmEntity } from './regulatory/oscu/infrastructure/persistence/oscu-code.orm-entity';
import { OscuItemClassificationOrmEntity } from './regulatory/oscu/infrastructure/persistence/oscu-item-classification.orm-entity';
import { OscuSyncStateOrmEntity } from './regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';
import { PaymentTypeMappingOrmEntity } from './regulatory/oscu/infrastructure/persistence/payment-type-mapping.orm-entity';
import { TaxMappingOrmEntity } from './regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';
import { UnitMappingOrmEntity } from './regulatory/oscu/infrastructure/persistence/unit-mapping.orm-entity';
import { ComplianceDocumentOrmEntity } from './sales/infrastructure/persistence/compliance-document.orm-entity';
import { ComplianceEventOrmEntity } from './sales/infrastructure/persistence/compliance-event.orm-entity';
import { ComplianceLineOrmEntity } from './sales/infrastructure/persistence/compliance-line.orm-entity';
import { PlatformCorrelationModule } from './integration/platform-correlation.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      name: 'default',
      type: 'mysql',
      connectorPackage: 'mysql2',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      username: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || 'password',
      database: process.env.DB_DATABASE || 'compliance',
      entities: [
        CatalogItemOrmEntity,
        ClassificationMappingOrmEntity,
        ComplianceBranchOrmEntity,
        ComplianceDocumentOrmEntity,
        ComplianceEtimsConnectionOrmEntity,
        ComplianceEventOrmEntity,
        ComplianceLineOrmEntity,
        ComplianceTenantOrmEntity,
        OscuCodeClassOrmEntity,
        OscuCodeOrmEntity,
        OscuItemClassificationOrmEntity,
        OscuSyncStateOrmEntity,
        PaymentTypeMappingOrmEntity,
        TaxMappingOrmEntity,
        UnitMappingOrmEntity,
      ],
      synchronize: true,
      logging: true,
    }),
    OscuReferenceModule,
    OscuMappingModule,
    PlatformCorrelationModule,
    CatalogModule,
    ComplianceOrganizationModule,
    InventoryModule,
    SalesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
