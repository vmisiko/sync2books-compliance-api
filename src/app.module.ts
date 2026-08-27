import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CatalogModule } from './catalog/catalog.module';
import { ComplianceOrganizationModule } from './compliance-organization/compliance-organization.module';
import { DashboardBusinessModule } from './dashboard-business/dashboard-business.module';
import { DashboardCatalogModule } from './dashboard-catalog/dashboard-catalog.module';
import { DashboardCustomersModule } from './dashboard-customers/dashboard-customers.module';
import { DashboardIdentityModule } from './dashboard-identity/dashboard-identity.module';
import { DashboardInventoryModule } from './dashboard-inventory/dashboard-inventory.module';
import { DashboardInvoicesModule } from './dashboard-invoices/dashboard-invoices.module';
import { DashboardMappingModule } from './dashboard-mapping/dashboard-mapping.module';
import { DashboardOrganizationModule } from './dashboard-organization/dashboard-organization.module';
import { DashboardPurchasesModule } from './dashboard-purchases/dashboard-purchases.module';
import { DashboardSuppliersModule } from './dashboard-suppliers/dashboard-suppliers.module';
import { InventoryModule } from './inventory/inventory.module';
import { OscuMappingModule } from './regulatory/oscu/oscu-mapping.module';
import { OscuOperationsModule } from './regulatory/oscu/presentation/oscu-operations.module';
import { OscuReferenceModule } from './regulatory/oscu/oscu-reference.module';
import { SalesModule } from './sales/sales.module';
import { CatalogItemOrmEntity } from './catalog/infrastructure/persistence/catalog-item.orm-entity';
import { ComplianceBranchOrmEntity } from './compliance-organization/infrastructure/persistence/compliance-branch.orm-entity';
import { ComplianceEtimsConnectionOrmEntity } from './compliance-organization/infrastructure/persistence/compliance-etims-connection.orm-entity';
import { ComplianceTenantOrmEntity } from './compliance-organization/infrastructure/persistence/compliance-tenant.orm-entity';
import { OscuCodeClassOrmEntity } from './regulatory/oscu/infrastructure/persistence/oscu-code-class.orm-entity';
import { OscuCodeOrmEntity } from './regulatory/oscu/infrastructure/persistence/oscu-code.orm-entity';
import { OscuItemClassificationOrmEntity } from './regulatory/oscu/infrastructure/persistence/oscu-item-classification.orm-entity';
import { OscuOperationLogOrmEntity } from './regulatory/oscu/infrastructure/persistence/oscu-operation-log.orm-entity';
import { OscuSyncStateOrmEntity } from './regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';
import { PaymentTypeMappingOrmEntity } from './regulatory/oscu/infrastructure/persistence/payment-type-mapping.orm-entity';
import { TaxMappingOrmEntity } from './regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';
import { UnitMappingOrmEntity } from './regulatory/oscu/infrastructure/persistence/unit-mapping.orm-entity';
import { ComplianceDocumentOrmEntity } from './sales/infrastructure/persistence/compliance-document.orm-entity';
import { ComplianceEventOrmEntity } from './sales/infrastructure/persistence/compliance-event.orm-entity';
import { ComplianceLineOrmEntity } from './sales/infrastructure/persistence/compliance-line.orm-entity';
import { CustomerOrmEntity } from './dashboard-customers/infrastructure/persistence/customer.orm-entity';
import { DashboardUserOrmEntity } from './dashboard-identity/infrastructure/persistence/dashboard-user.orm-entity';
import { DashboardOrganizationOrmEntity } from './dashboard-organization/infrastructure/persistence/dashboard-organization.orm-entity';
import { InventoryStockOrmEntity } from './inventory/infrastructure/persistence/inventory-stock.orm-entity';
import { StockMovementOrmEntity } from './inventory/infrastructure/persistence/stock-movement.orm-entity';
import { MainApiConnectionOrmEntity } from './integration/main-api-pull/infrastructure/persistence/main-api-connection.orm-entity';
import { MainApiPullModule } from './integration/main-api-pull/main-api-pull.module';
import { PlatformCorrelationModule } from './integration/platform-correlation.module';
import { PurchaseInvoiceOrmEntity } from './dashboard-purchases/infrastructure/persistence/purchase-invoice.orm-entity';
import { SupplierOrmEntity } from './dashboard-suppliers/infrastructure/persistence/supplier.orm-entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
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
        ComplianceBranchOrmEntity,
        ComplianceDocumentOrmEntity,
        ComplianceEtimsConnectionOrmEntity,
        ComplianceEventOrmEntity,
        ComplianceLineOrmEntity,
        ComplianceTenantOrmEntity,
        CustomerOrmEntity,
        DashboardOrganizationOrmEntity,
        DashboardUserOrmEntity,
        InventoryStockOrmEntity,
        MainApiConnectionOrmEntity,
        OscuCodeClassOrmEntity,
        OscuCodeOrmEntity,
        OscuItemClassificationOrmEntity,
        OscuOperationLogOrmEntity,
        OscuSyncStateOrmEntity,
        PaymentTypeMappingOrmEntity,
        PurchaseInvoiceOrmEntity,
        StockMovementOrmEntity,
        SupplierOrmEntity,
        TaxMappingOrmEntity,
        UnitMappingOrmEntity,
      ],
      synchronize: true,
      logging: true,
    }),
    OscuReferenceModule,
    OscuMappingModule,
    OscuOperationsModule,
    PlatformCorrelationModule,
    CatalogModule,
    ComplianceOrganizationModule,
    DashboardBusinessModule,
    DashboardCatalogModule,
    DashboardCustomersModule,
    DashboardIdentityModule,
    DashboardInventoryModule,
    DashboardInvoicesModule,
    DashboardMappingModule,
    DashboardOrganizationModule,
    DashboardPurchasesModule,
    DashboardSuppliersModule,
    InventoryModule,
    MainApiPullModule,
    SalesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
