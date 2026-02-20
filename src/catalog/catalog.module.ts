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
import { TaxMappingOrmEntity } from '../regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';
import { UnitMappingOrmEntity } from '../regulatory/oscu/infrastructure/persistence/unit-mapping.orm-entity';

@Module({
  imports: [
    OscuMappingModule,
    TypeOrmModule.forFeature([
      CatalogItemOrmEntity,
      TaxMappingOrmEntity,
      UnitMappingOrmEntity,
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
