import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceDocumentOrmEntity } from '../sales/infrastructure/persistence/compliance-document.orm-entity';
import { CatalogItemOrmEntity } from '../catalog/infrastructure/persistence/catalog-item.orm-entity';
import { Sync2BooksMainApiOscuClient } from './platform-outbound/sync2books-main-api-oscu.client';
import { PlatformOscuCallbackService } from './platform-outbound/platform-oscu-callback.service';
import { Sync2BooksCorrelationPersistenceService } from './platform-outbound/sync2books-correlation-persistence.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ComplianceDocumentOrmEntity,
      CatalogItemOrmEntity,
    ]),
  ],
  providers: [
    Sync2BooksMainApiOscuClient,
    PlatformOscuCallbackService,
    Sync2BooksCorrelationPersistenceService,
  ],
  exports: [
    Sync2BooksMainApiOscuClient,
    PlatformOscuCallbackService,
    Sync2BooksCorrelationPersistenceService,
  ],
})
export class PlatformCorrelationModule {}
