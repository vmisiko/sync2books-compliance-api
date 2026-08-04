import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ComplianceDocumentOrmEntity } from '../../sales/infrastructure/persistence/compliance-document.orm-entity';
import { CatalogItemOrmEntity } from '../../catalog/infrastructure/persistence/catalog-item.orm-entity';
import type { Sync2BooksCorrelationStored } from './sync2books-correlation.types';

/**
 * Persists Main API Pattern 2 headers on domain rows so retries can
 * POST oscu-outcome without the original HTTP request.
 */
@Injectable()
export class Sync2BooksCorrelationPersistenceService {
  constructor(
    @InjectRepository(ComplianceDocumentOrmEntity)
    private readonly documents: Repository<ComplianceDocumentOrmEntity>,
    @InjectRepository(CatalogItemOrmEntity)
    private readonly catalogItems: Repository<CatalogItemOrmEntity>,
  ) {}

  async patchComplianceDocument(
    documentId: string,
    corr: Sync2BooksCorrelationStored,
  ): Promise<void> {
    await this.documents.update({ id: documentId }, {
      sync2booksCorrelation: { ...corr },
    } as Parameters<Repository<ComplianceDocumentOrmEntity>['update']>[1]);
  }

  async patchCatalogItem(
    itemId: string,
    corr: Sync2BooksCorrelationStored,
  ): Promise<void> {
    await this.catalogItems.update({ id: itemId }, {
      sync2booksCorrelation: { ...corr },
    } as Parameters<Repository<CatalogItemOrmEntity>['update']>[1]);
  }

  async patchCatalogItems(
    itemIds: string[],
    corr: Sync2BooksCorrelationStored,
  ): Promise<void> {
    if (itemIds.length === 0) {
      return;
    }
    await this.catalogItems.update({ id: In(itemIds) }, {
      sync2booksCorrelation: { ...corr },
    } as Parameters<Repository<CatalogItemOrmEntity>['update']>[1]);
  }
}
