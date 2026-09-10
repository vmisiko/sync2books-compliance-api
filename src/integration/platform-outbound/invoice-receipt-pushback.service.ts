import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComplianceDocumentOrmEntity } from '../../sales/infrastructure/persistence/compliance-document.orm-entity';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { MainApiConnectionApplicationService } from '../main-api-pull/application/main-api-connection.application.service';
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import { Sync2BooksCorrelationPersistenceService } from './sync2books-correlation-persistence.service';
import { Sync2BooksMainApiOscuClient } from './sync2books-main-api-oscu.client';

/**
 * Why a notification was not sent. `NOT_ACCEPTED` is the one callers usually
 * want to react to: there is no receipt to push yet, and pushing anyway is
 * what used to poison the invoice on Main API's side (it recorded
 * `complianceDocumentId` before discovering the receipt PDF didn't exist).
 */
export type ReceiptPushbackSkipReason =
  | 'NOT_ACCEPTED'
  | 'ALREADY_NOTIFIED'
  | 'AUTO_UPLOAD_DISABLED'
  | 'NO_MAIN_API_COMPANY'
  | 'NO_SOURCE_INVOICE'
  | 'DOCUMENT_NOT_FOUND'
  | 'ERROR';

export type ReceiptPushbackResult =
  | { notified: true; syncItemId: string; syncBatchId: string }
  | { notified: false; reason: ReceiptPushbackSkipReason; message?: string };

/**
 * Owns the "tell Main API an eTIMS receipt is ready for this ERP invoice"
 * side-effect: `POST /internal/compliance/invoice-receipt`, which makes Main
 * API enqueue the `etims-receipt-attachment` sync_item that pushes the receipt
 * PDF onto the originating QuickBooks/Odoo/Dynamics invoice.
 *
 * Extracted out of `DashboardInvoicesApplicationService` so the retry path
 * (`SalesService.retrySales`, driven from `DashboardSalesController`) can fire
 * it too. Retried sales reach ACCEPTED without ever passing through
 * `createSaleFromInvoice` again, so before this existed every sale that KRA
 * accepted on a *second* attempt silently never got its receipt back to the
 * ERP.
 *
 * `ACCEPTED` is enforced here, in the one place all callers funnel through,
 * rather than at each call site -- `SalesService.getEtimsReceiptPdf` returns
 * null for anything else, so notifying earlier can only ever produce a failed
 * sync_item on the other side.
 */
@Injectable()
export class InvoiceReceiptPushbackService {
  private readonly logger = new Logger(InvoiceReceiptPushbackService.name);

  constructor(
    @InjectRepository(ComplianceDocumentOrmEntity)
    private readonly documents: Repository<ComplianceDocumentOrmEntity>,
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiOscuClient: Sync2BooksMainApiOscuClient,
    private readonly correlationPersistence: Sync2BooksCorrelationPersistenceService,
  ) {}

  /**
   * Notifies Main API that `documentId`'s receipt is ready to be attached to
   * `sourceInvoiceId`. Never throws -- a receipt push-back failure must not
   * fail the sale creation/submission/retry that triggered it; the outcome is
   * returned instead so a user-initiated caller can surface it.
   *
   * `options.force` (the manual "Upload receipt" route) bypasses the tenant's
   * `autoUploadReceiptToSource` toggle and the "already notified" guard, but
   * never the ACCEPTED requirement.
   */
  async notify(
    complianceTenantId: string,
    documentId: string,
    sourceInvoiceId: string,
    options: { force?: boolean } = {},
  ): Promise<ReceiptPushbackResult> {
    try {
      // Read the document's *current* state rather than trusting a status the
      // caller captured earlier: `createSaleFromInvoice`'s self-heal branch
      // used a pre-submit snapshot, so a DRAFT it had just submitted and got
      // ACCEPTED still looked like a DRAFT here and was never notified.
      const document = await this.documents.findOne({
        where: { id: documentId },
        select: [
          'id',
          'complianceStatus',
          'sourceInvoiceId',
          'mainApiSyncItemId',
        ],
      });
      if (!document) {
        this.logger.warn(
          `Compliance document ${documentId} not found — skipping invoice-receipt notification`,
        );
        return { notified: false, reason: 'DOCUMENT_NOT_FOUND' };
      }

      // The ORM column is a plain varchar; narrow it before comparing so this
      // reads as the state-machine check it is.
      const status = document.complianceStatus as ComplianceStatus;
      if (status !== ComplianceStatus.ACCEPTED) {
        this.logger.log(
          `Document ${documentId} is ${status}, not ACCEPTED — nothing to push back for invoice ${sourceInvoiceId} yet`,
        );
        return { notified: false, reason: 'NOT_ACCEPTED' };
      }

      if (!options.force && document.mainApiSyncItemId) {
        this.logger.log(
          `Document ${documentId} already has Main API sync item ${document.mainApiSyncItemId} — skipping duplicate invoice-receipt notification`,
        );
        return { notified: false, reason: 'ALREADY_NOTIFIED' };
      }

      const connection =
        await this.mainApiConnections.getForTenant(complianceTenantId);
      if (!options.force && connection.autoUploadReceiptToSource === false) {
        this.logger.log(
          `Auto receipt upload is disabled for tenant ${complianceTenantId} — skipping automatic invoice-receipt notification for document ${documentId}`,
        );
        return { notified: false, reason: 'AUTO_UPLOAD_DISABLED' };
      }
      if (!connection.mainApiCompanyId) {
        this.logger.warn(
          `Tenant ${complianceTenantId} has no mainApiCompanyId yet — skipping invoice-receipt notification for document ${documentId}`,
        );
        return { notified: false, reason: 'NO_MAIN_API_COMPANY' };
      }

      const receipt = await this.mainApiOscuClient.postInvoiceReceipt({
        sourceInvoiceId,
        companyId: connection.mainApiCompanyId,
        applicationId: connection.mainApiApplicationId,
        complianceDocumentId: documentId,
      });
      await this.correlationPersistence.patchMainApiSyncRef(
        documentId,
        receipt.syncItemId,
        receipt.syncBatchId,
      );
      await this.correlationPersistence.patchAttachmentSyncStatus(
        documentId,
        receipt.status,
        null,
      );
      return {
        notified: true,
        syncItemId: receipt.syncItemId,
        syncBatchId: receipt.syncBatchId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `invoice-receipt notification failed for document ${documentId} (invoice ${sourceInvoiceId}): ${message}`,
      );
      return { notified: false, reason: 'ERROR', message };
    }
  }

  /**
   * Push-back hook for `POST /dashboard-api/sales/sync` (retry to KRA): fires
   * `notify` for every retried document that is now ACCEPTED and came from an
   * ERP invoice. Documents entered manually have no `sourceInvoiceId` and are
   * skipped -- there is no ERP invoice to attach anything to.
   *
   * Best-effort and never throws, exactly like `notify`: a retry that got the
   * sale accepted by KRA has succeeded regardless of what happens to the
   * receipt attachment afterwards.
   */
  async notifyForRetriedDocuments(
    merchantId: string,
    documentIds: string[],
  ): Promise<void> {
    if (!documentIds.length) return;

    const tenant =
      await this.organization.getTenantBySync2booksCompanyId(merchantId);
    if (!tenant) {
      this.logger.warn(
        `No compliance tenant for merchant ${merchantId} — skipping invoice-receipt notification for ${documentIds.length} retried document(s)`,
      );
      return;
    }

    for (const documentId of documentIds) {
      const document = await this.documents.findOne({
        where: { id: documentId },
        select: ['id', 'sourceInvoiceId'],
      });
      if (!document?.sourceInvoiceId) continue;

      await this.notify(tenant.id, documentId, document.sourceInvoiceId);
    }
  }
}
