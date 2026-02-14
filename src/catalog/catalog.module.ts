import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogService } from './api/catalog.service';
import { CatalogController } from './api/catalog.controller';
import { ClassificationResolverStub } from './infrastructure/classification-resolver.stub';
import { CatalogItemOrmEntity } from './infrastructure/persistence/catalog-item.orm-entity';
import { CatalogItemTypeOrmRepository } from './infrastructure/persistence/catalog-item-typeorm.repository';
import { CatalogSeed } from './infrastructure/persistence/catalog-seed';
import {
  CATALOG_ITEM_REPO,
  CLASSIFICATION_RESOLVER,
  ITEM_REPO,
} from '../shared/tokens';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogItemOrmEntity])],
  controllers: [CatalogController],
  providers: [
    {
      provide: CATALOG_ITEM_REPO,
      useClass: CatalogItemTypeOrmRepository,
    },
    { provide: CLASSIFICATION_RESOLVER, useClass: ClassificationResolverStub },
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
