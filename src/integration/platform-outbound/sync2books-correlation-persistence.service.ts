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

  /**
   * Persists the Main API sync_item/sync_batch ids returned by
   * `POST /internal/compliance/invoice-receipt` (see
   * `Sync2BooksMainApiOscuClient.postInvoiceReceipt`) so the dashboard's
   * receipt-attachment-status/retry-receipt-attachment routes can look the
   * sync item up later without re-deriving it.
   */
  async patchMainApiSyncRef(
    documentId: string,
    mainApiSyncItemId: string,
    mainApiSyncBatchId: string,
  ): Promise<void> {
    await this.documents.update(
      { id: documentId },
      { mainApiSyncItemId, mainApiSyncBatchId },
    );
  }

  /**
   * Caches the Main API sync_item's own status/error for the eTIMS
   * receipt-attachment push, so the sales list's "ERP Sync" column can show
   * a real value without a per-row Main API call. Called right after
   * `notifyMainApiOfReceipt` first records a status, and again whenever the
   * dashboard's receipt-attachment-status route does a live check.
   */
  async patchAttachmentSyncStatus(
    documentId: string,
    attachmentSyncStatus: string | null,
    attachmentSyncError: string | null,
  ): Promise<void> {
    await this.documents.update(
      { id: documentId },
      { attachmentSyncStatus, attachmentSyncError },
    );
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
