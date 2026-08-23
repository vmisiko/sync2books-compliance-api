import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { DashboardIdentityModule } from '../dashboard-identity/dashboard-identity.module';
import { MainApiPullModule } from '../integration/main-api-pull/main-api-pull.module';
import { OscuMappingModule } from '../regulatory/oscu/oscu-mapping.module';
import { ClassificationMappingOrmEntity } from '../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';
import { DashboardItemsApplicationService } from './application/dashboard-items.application.service';
import { DashboardItemsController } from './presentation/dashboard-items.controller';

@Module({
  imports: [
    CatalogModule,
    ComplianceOrganizationModule,
    DashboardIdentityModule,
    MainApiPullModule,
    OscuMappingModule,
    TypeOrmModule.forFeature([ClassificationMappingOrmEntity]),
  ],
  controllers: [DashboardItemsController],
  providers: [DashboardItemsApplicationService],
  exports: [DashboardItemsApplicationService],
})
export class DashboardCatalogModule {}
