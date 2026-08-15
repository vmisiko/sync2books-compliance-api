import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogService } from './api/catalog.service';
import { CatalogController } from './api/catalog.controller';
import { ClassificationResolverTypeOrm } from './infrastructure/classification-resolver.typeorm';
import { CatalogItemOrmEntity } from './infrastructure/persistence/catalog-item.orm-entity';
import { CatalogItemTypeOrmRepository } from './infrastructure/persistence/catalog-item-typeorm.repository';
import { CatalogSeed } from './infrastructure/persistence/catalog-seed';
import {
  CATALOG_ITEM_REPO,
  CLASSIFICATION_RESOLVER,
  ITEM_REPO,
} from '../shared/tokens';
import { ClassificationMappingOrmEntity } from '../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';
import { OscuMappingModule } from '../regulatory/oscu/oscu-mapping.module';
import { OscuReferenceModule } from '../regulatory/oscu/oscu-reference.module';
import { TaxMappingOrmEntity } from '../regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';
import { ComplianceOrganizationModule } from '../compliance-organization/compliance-organization.module';
import { EtimsModule } from '../regulatory/oscu/etims.module';
import { ComplianceServiceAuthModule } from '../integration/compliance-service-auth.module';
import { PlatformCorrelationModule } from '../integration/platform-correlation.module';

@Module({
  imports: [
    ComplianceServiceAuthModule,
    PlatformCorrelationModule,
    OscuMappingModule,
    OscuReferenceModule,
    ComplianceOrganizationModule,
    EtimsModule,
    TypeOrmModule.forFeature([
      CatalogItemOrmEntity,
      TaxMappingOrmEntity,
      ClassificationMappingOrmEntity,
    ]),
  ],
  controllers: [CatalogController],
  providers: [
    {
      provide: CATALOG_ITEM_REPO,
      useClass: CatalogItemTypeOrmRepository,
    },
    {
      provide: CLASSIFICATION_RESOLVER,
      useClass: ClassificationResolverTypeOrm,
    },
    { provide: ITEM_REPO, useExisting: CATALOG_ITEM_REPO },
    CatalogService,
    CatalogSeed,
  ],
  exports: [CatalogService, CATALOG_ITEM_REPO, ITEM_REPO],
})
export class CatalogModule implements OnModuleInit {
  constructor(private readonly seed: CatalogSeed) {}

  async onModuleInit(): Promise<void> {
    await this.seed.runIfEmpty();
  }
}
