import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { CatalogService } from '../../catalog/api/catalog.service';
import { PAYMENT_TYPE_RESOLVER } from '../../shared/tokens';
import type { IPaymentTypeResolver } from '../../regulatory/oscu/domain/ports/payment-type-resolver.port';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import {
  MainApiConnectionApplicationService,
  SUPPORTED_INTEGRATION_KEYS,
  type SupportedIntegrationKey,
} from '../../integration/main-api-pull/application/main-api-connection.application.service';
import {
  MainApiPullClient,
  type MainApiInvoice,
} from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { PlatformOscuCallbackService } from '../../integration/platform-outbound/platform-oscu-callback.service';
import { Sync2BooksCorrelationPersistenceService } from '../../integration/platform-outbound/sync2books-correlation-persistence.service';
import { Sync2BooksMainApiOscuClient } from '../../integration/platform-outbound/sync2books-main-api-oscu.client';
import { parseSync2BooksCorrelation } from '../../integration/platform-outbound/sync2books-request-headers.util';
import { SalesService } from '../../sales/application/sales.service';
import { expectedTaxAmount } from '../../sales/domain/rules/tax-rule.engine';
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../shared/domain/enums/source-system.enum';

export type PulledInvoiceLine = {
  description?: string;
  quantity: number;
  unitAmount: number;
  taxAmount?: number;
  totalAmount?: number;
  itemExternalId: string | null;
  itemName?: string;
  catalogItemId: string | null;
  classified: boolean;
};

export type PulledInvoice = {
  mainApiInvoiceId: string;
  invoiceCode: string;
  reference?: string;
  issueDate: string;
  currency: string;
  status: string;
  subTotal: number;
  taxAmount: number;
  totalAmount: number;
  customerName?: string;
  lines: PulledInvoiceLine[];
  /** false if any line's item hasn't been registered/classified in the catalog yet. */
  readyForSale: boolean;
  sourceSystem: SourceSystem | null;
};

/**
 * Resolves which ERP an invoice pull should target — mirrors
 * DashboardCustomersApplicationService's resolveCustomerPullSource. An
 * explicit `source` (the dashboard's ERP selector, once connected to more
 * than one integration) always wins; otherwise pick whichever supported
 * integration actually has a connectionId instead of blindly defaulting to
 * QuickBooks, which would silently show "0 pulled" for an Odoo-only tenant.
 */
function resolveInvoicePullSource(
  source: string | undefined,
  integrations: Partial<
    Record<SupportedIntegrationKey, { connectionId: string | null }>
  >,
): SupportedIntegrationKey {
  if (source) {
    const key = source.toLowerCase();
    if (!(SUPPORTED_INTEGRATION_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException(
        `Unsupported pull source: ${source}. Must be one of ${SUPPORTED_INTEGRATION_KEYS.join(', ')}`,
      );
    }
    return key as SupportedIntegrationKey;
  }

  const connected = SUPPORTED_INTEGRATION_KEYS.find(
    (key) => integrations?.[key]?.connectionId,
  );
  return connected ?? 'quickbooks';
}

@Injectable()
export class DashboardInvoicesApplicationService {
  private readonly logger = new Logger(
    DashboardInvoicesApplicationService.name,
  );

  constructor(
    private readonly catalog: CatalogService,
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
    private readonly sales: SalesService,
    private readonly oscuCallback: PlatformOscuCallbackService,
    private readonly correlationPersistence: Sync2BooksCorrelationPersistenceService,
    private readonly mainApiOscuClient: Sync2BooksMainApiOscuClient,
    @Inject(PAYMENT_TYPE_RESOLVER)
    private readonly paymentTypeResolver: IPaymentTypeResolver,
  ) {}

  async pullInvoices(
    complianceTenantId: string,
    params: {
      page?: number;
      limit?: number;
      source?: string;
      startDate?: string;
      endDate?: string;
    } = {},
  ) {
    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);

    const pullSource = resolveInvoicePullSource(
      params.source,
      connection.integrations,
    );
    const connectionId = connection.integrations[pullSource]?.connectionId;
    if (connectionId) {
      try {
        await this.mainApiPull.syncInvoicesFromBookkeeping(
          connection.mainApiApiKey,
          connectionId,
        );
      } catch (error) {
        this.logger.warn(
          `sync-from-bookkeeping (invoices) failed for tenant ${complianceTenantId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return this.listInvoices(complianceTenantId, params);
  }

  async listInvoices(
    complianceTenantId: string,
    params: {
      page?: number;
      limit?: number;
      startDate?: string;
      endDate?: string;
    } = {},
  ) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);
    // Main API's GET /invoices now requires companyId/connectionId scoping
    // -- see main-api-pull.client.ts's getInvoices doc comment for why (it
    // used to leak every company's invoices to every tenant sharing the
    // main API Application).
    if (!connection.mainApiCompanyId) {
      throw new BadRequestException(
        'This tenant has no main-API company resolved yet — reconnect an ERP before listing invoices.',
      );
    }

    const response = await this.mainApiPull.getInvoices(
      connection.mainApiApiKey,
      connection.mainApiCompanyId,
      params,
    );
    const invoices = await Promise.all(
      response.data.map((invoice) => this.enrich(merchantId, invoice)),
    );

    return {
      data: invoices,
      total: response.total,
      page: response.page,
      limit: response.limit,
      totalPages: response.totalPages,
    };
  }

  async getInvoiceById(complianceTenantId: string, mainApiInvoiceId: string) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);

    const invoice = await this.mainApiPull.getInvoiceById(
      connection.mainApiApiKey,
      mainApiInvoiceId,
    );
    return this.enrich(merchantId, invoice);
  }

  /**
   * Creates a Sale from a pulled invoice, and submits it to eTIMS by default.
   * Every line's item must already be registered+classified in the catalog —
   * this never auto-registers items, matching the deliberate two-step flow
   * (classify first, then sell) called for by the dashboard's workflow.
   */
  async createSaleFromInvoice(
    complianceTenantId: string,
    mainApiInvoiceId: string,
    options: { submit?: boolean } = {},
    req?: Request,
  ) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const pulled = await this.getInvoiceById(
      complianceTenantId,
      mainApiInvoiceId,
    );

    if (!pulled.readyForSale) {
      const unclassified = pulled.lines
        .filter((l) => !l.classified)
        .map((l) => l.itemName ?? l.itemExternalId ?? 'unknown item');
      throw new BadRequestException({
        message:
          'This invoice has unclassified items — classify them (POST /dashboard-api/items/pull, then PATCH classification) before creating a sale',
        unclassifiedItems: unclassified,
      });
    }

    const branches = await this.organization.listBranches(complianceTenantId);
    const branch = branches[0];
    if (!branch) {
      throw new BadRequestException('No branch configured for this tenant');
    }
    if (!branch.sync2booksBranchId) {
      throw new BadRequestException(
        `Branch ${branch.id} has no linked sync2books branch id — link an ERP branch before submitting to KRA`,
      );
    }

    const lines = await Promise.all(
      pulled.lines.map(async (line) => {
        const catalogItem = await this.catalog.getItemById(
          line.catalogItemId as string,
        );
        if (!catalogItem) {
          throw new BadRequestException(
            `Catalog item ${line.catalogItemId} no longer exists`,
          );
        }
        // Don't trust the pulled line's own taxAmount -- QuickBooks (and
        // likely other ERPs) only total tax at the invoice header
        // (TxnTaxDetail), never per SalesItemLine, so it's reliably absent
        // here. Compute it the same way SalesService's tax-rule engine will
        // validate it, from the catalog item's actual taxCategory, so this
        // never submits a line doomed to fail TAX_VAT_STANDARD_RATE/TAX_VAT_8_RATE.
        return {
          itemId: catalogItem.id,
          description: line.description ?? catalogItem.name,
          quantity: line.quantity,
          unitPrice: line.unitAmount,
          taxCategory: catalogItem.taxCategory,
          taxAmount: expectedTaxAmount(
            catalogItem.taxCategory,
            line.quantity,
            line.unitAmount,
          ),
        };
      }),
    );

    // QuickBooks Invoice objects are inherently on-credit documents by QuickBooks' own
    // object model (a payment-now sale is a SalesReceipt, which this pull never touches) —
    // so resolve to the tenant's CREDIT mapping rather than assuming CASH. Falls back to
    // the raw '02' code only if the payment mapping table is somehow missing its global
    // seed row, which oscu-mapping.seed.ts guarantees it isn't.
    const paymentTypeCode = await this.paymentTypeResolver
      .resolve(merchantId, 'CREDIT')
      .catch(() => '02');

    const createResult = await this.sales.createDocument(
      {
        merchantId,
        branchId: branch.sync2booksBranchId,
        // Prefer the real ERP provenance main API's standardization layer
        // resolved for this invoice (see enrich()); fall back to the generic
        // API tag only when that ERP isn't standardized yet, so this doesn't
        // regress to always claiming QuickBooks/API for every pulled sale.
        sourceSystem: pulled.sourceSystem ?? SourceSystem.API,
        sourceDocumentId: pulled.invoiceCode,
        documentType: DocumentType.SALE,
        documentNumber: pulled.reference ?? pulled.invoiceCode,
        originalDocumentNumber: null,
        originalSaleId: null,
        sourceInvoiceId: pulled.mainApiInvoiceId,
        creditNoteDate: null,
        creditNoteReasonCode: null,
        saleDate: pulled.issueDate.slice(0, 10),
        receiptTypeCode: 'S',
        paymentTypeCode,
        invoiceStatusCode: '02',
        currency: pulled.currency || 'KES',
        exchangeRate: 1,
        subtotalAmount: lines.reduce(
          (sum, l) => sum + l.quantity * l.unitPrice,
          0,
        ),
        totalTax: lines.reduce((sum, l) => sum + l.taxAmount, 0),
        totalAmount: lines.reduce(
          (sum, l) => sum + l.quantity * l.unitPrice + l.taxAmount,
          0,
        ),
        customerPin: null,
        lines,
      },
      { enqueueProcessing: false },
    );

    const documentId = (createResult.document as { id: string }).id;
    const shouldSubmit = options.submit ?? true;

    if (createResult.created && shouldSubmit) {
      await this.sales.submitDraftDocument(documentId);

      // Opportunistic, same pattern as ApiSalesController: only fires when
      // the request carries Main API's Pattern 2 correlation headers.
      const corr = req ? parseSync2BooksCorrelation(req) : null;
      if (corr) {
        await this.correlationPersistence.patchComplianceDocument(
          documentId,
          corr,
        );
        await this.oscuCallback.postOutcomeWithCorrelation(corr, {
          channel: 'SALES_DOCUMENT',
          aggregateStatus: 'SUCCESS',
          complianceStatus: 'ACCEPTED',
          complianceDocumentId: documentId,
          oscuPhase: 'FINAL',
          eventId: randomUUID(),
          raw: { documentType: DocumentType.SALE },
          sourceInvoiceId: pulled.mainApiInvoiceId,
        });
      }

      // Unconditional, separate from the opportunistic block above: notifies
      // Main API of this eTIMS submission via the new invoice-receipt route,
      // which needs no correlation headers/pre-existing sync_item — just the
      // tenant's Main-API company/application ids. Best-effort: a failure
      // here must not fail the sale-creation flow.
      await this.notifyMainApiOfReceipt(
        complianceTenantId,
        documentId,
        pulled.mainApiInvoiceId,
      );
    } else if (!createResult.created) {
      // Idempotency matched a document that already existed for this invoice
      // (e.g. one created before `sourceInvoiceId` existed, or a run that was
      // interrupted before it could submit/notify). Self-heal it here instead
      // of leaving it permanently stuck: every branch below only ever runs
      // from this invoice-linked path, so it can never apply to a manually
      // entered sale (those never have a `mainApiInvoiceId` to backfill from
      // in the first place — `sourceInvoiceId` stays null for them, correctly,
      // since there's no ERP invoice to attach a receipt to).
      const existing = createResult.document as {
        sourceInvoiceId: string | null;
        mainApiSyncItemId: string | null;
        complianceStatus: ComplianceStatus;
      };

      if (existing.sourceInvoiceId !== pulled.mainApiInvoiceId) {
        await this.sales.patchSourceInvoiceLink(
          documentId,
          pulled.mainApiInvoiceId,
        );
      }

      if (shouldSubmit) {
        // Resume from wherever the document actually got stuck. Inventory
        // movements were already applied on the original attempt for
        // VALIDATED/READY_FOR_SUBMISSION (that's how it got past DRAFT in the
        // first place) -- only the DRAFT case goes through
        // `submitDraftDocument` (which applies them). Re-applying here would
        // double-debit stock, so the VALIDATED/READY_FOR_SUBMISSION branches
        // call `prepareDocument`/`submitDocument` directly instead.
        switch (existing.complianceStatus) {
          case ComplianceStatus.DRAFT:
            await this.sales.submitDraftDocument(documentId);
            break;
          case ComplianceStatus.VALIDATED:
            await this.sales.prepareDocument(documentId);
            await this.sales.submitDocument(documentId);
            break;
          case ComplianceStatus.READY_FOR_SUBMISSION:
            await this.sales.submitDocument(documentId);
            break;
          default:
            // SUBMITTED/ACCEPTED/REJECTED/FAILED/RETRYING/CANCELLED: already
            // past this point or needs the dedicated retry flow -- no-op here.
            break;
        }
      }

      const alreadyAccepted =
        existing.complianceStatus === ComplianceStatus.ACCEPTED ||
        existing.complianceStatus === ComplianceStatus.SUBMITTED;
      if (alreadyAccepted && !existing.mainApiSyncItemId) {
        await this.notifyMainApiOfReceipt(
          complianceTenantId,
          documentId,
          pulled.mainApiInvoiceId,
        );
      }
    }

    return this.sales.getNormalizedSaleReport(documentId);
  }

  /**
   * Notifies Main API of a successful eTIMS submission via
   * `POST /internal/compliance/invoice-receipt` and records the returned
   * sync-item reference. Best-effort: a failure here must never fail the
   * caller's overall flow (sale creation or backfill). Shared by the
   * fresh-document path and the idempotency-match self-heal path in
   * `createSaleFromInvoice`, and by the manual `uploadReceiptToSource` route
   * (via `force: true`, which bypasses the tenant's `autoUploadReceiptToSource`
   * toggle so a user can always trigger it on demand).
   */
  private async notifyMainApiOfReceipt(
    complianceTenantId: string,
    documentId: string,
    sourceInvoiceId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    try {
      const connection =
        await this.mainApiConnections.getForTenant(complianceTenantId);
      if (!options.force && connection.autoUploadReceiptToSource === false) {
        this.logger.log(
          `Auto receipt upload is disabled for tenant ${complianceTenantId} — skipping automatic invoice-receipt notification for document ${documentId}`,
        );
        return;
      }
      if (!connection.mainApiCompanyId) {
        this.logger.warn(
          `Tenant ${complianceTenantId} has no mainApiCompanyId yet — skipping invoice-receipt notification for document ${documentId}`,
        );
        return;
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
    } catch (error) {
      this.logger.warn(
        `invoice-receipt notification failed for document ${documentId} (invoice ${sourceInvoiceId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Manually triggers the invoice-receipt push-back to Main API for the sale
   * created from a pulled invoice, regardless of the tenant's
   * `autoUploadReceiptToSource` toggle (see `MainApiConnectionApplicationService
   * .updateReceiptSettings`). Exists so a tenant that has turned auto-upload
   * off can still push a specific receipt on demand. Reuses
   * `getReceiptAttachmentStatus` for the response shape.
   */
  async uploadReceiptToSource(
    complianceTenantId: string,
    mainApiInvoiceId: string,
  ) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const document = await this.sales.getDocumentBySourceInvoiceId(
      merchantId,
      mainApiInvoiceId,
    );
    if (!document) {
      throw new BadRequestException(
        'No sale has been created from this invoice yet — nothing to upload',
      );
    }

    await this.notifyMainApiOfReceipt(
      complianceTenantId,
      document.id,
      mainApiInvoiceId,
      { force: true },
    );

    return this.getReceiptAttachmentStatus(complianceTenantId, mainApiInvoiceId);
  }

  /**
   * Reads the Main-API sync-item status for the sale created from a pulled
   * invoice, via the `mainApiSyncItemId` stored on its `ComplianceDocument`
   * by the unconditional invoice-receipt notification above.
   */
  async getReceiptAttachmentStatus(
    complianceTenantId: string,
    mainApiInvoiceId: string,
  ) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const document = await this.sales.getDocumentBySourceInvoiceId(
      merchantId,
      mainApiInvoiceId,
    );

    if (!document) {
      return {
        requested: false,
        message: 'No sale has been created from this invoice yet',
      };
    }
    if (!document.mainApiSyncItemId) {
      return {
        requested: false,
        complianceDocumentId: document.id,
        message:
          'Sale created, but Main API has not yet acknowledged the invoice-receipt notification — nothing to check yet',
      };
    }

    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);
    const status = await this.mainApiPull.getSyncItemStatus(
      connection.mainApiApiKey,
      document.mainApiSyncItemId,
    );
    await this.correlationPersistence.patchAttachmentSyncStatus(
      document.id,
      typeof status.status === 'string' ? status.status : null,
      typeof status.syncErrorMessage === 'string' ? status.syncErrorMessage : null,
    );

    return {
      requested: true,
      complianceDocumentId: document.id,
      syncItemId: document.mainApiSyncItemId,
      syncBatchId: document.mainApiSyncBatchId,
      status,
    };
  }

  /**
   * Retries the Main-API sync item recorded for the sale created from a
   * pulled invoice. 400s when nothing has been recorded yet (i.e. the
   * invoice-receipt notification never succeeded) — there is nothing to retry.
   */
  async retryReceiptAttachment(
    complianceTenantId: string,
    mainApiInvoiceId: string,
  ) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const document = await this.sales.getDocumentBySourceInvoiceId(
      merchantId,
      mainApiInvoiceId,
    );

    if (!document || !document.mainApiSyncItemId) {
      throw new BadRequestException(
        'No Main API sync item recorded for this invoice yet — nothing to retry',
      );
    }

    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);
    const result = await this.mainApiPull.retrySyncItem(
      connection.mainApiApiKey,
      document.mainApiSyncItemId,
    );

    return {
      complianceDocumentId: document.id,
      syncItemId: document.mainApiSyncItemId,
      result,
    };
  }

  private async enrich(
    merchantId: string,
    invoice: MainApiInvoice,
  ): Promise<PulledInvoice> {
    // Every line on one invoice shares the invoice's own source ERP -- pass
    // it through so a line's item lookup can't resolve to a different ERP's
    // catalog item that happens to share the same small numeric externalId
    // (see ClassificationResolverTypeOrm's doc comment for the same bug
    // class; this call site bypasses that resolver entirely, so it needs
    // its own fix).
    const invoiceSourceSystem = invoice.standardized?.sourceSystem ?? null;
    const lines = await Promise.all(
      invoice.lineItems.map(async (line) => {
        const itemExternalId = line.itemRef?.id ?? null;
        const catalogItem = itemExternalId
          ? await this.catalog.findByExternalId(
              merchantId,
              itemExternalId,
              invoiceSourceSystem,
            )
          : null;

        return {
          description: line.description,
          quantity: line.quantity,
          unitAmount: line.unitAmount,
          taxAmount: line.taxAmount,
          totalAmount: line.totalAmount,
          itemExternalId,
          itemName: line.itemRef?.name,
          catalogItemId: catalogItem?.id ?? null,
          classified: Boolean(catalogItem),
        };
      }),
    );

    return {
      mainApiInvoiceId: invoice.id,
      invoiceCode: invoice.invoiceCode,
      reference: invoice.reference,
      issueDate: invoice.issueDate,
      currency: invoice.currency,
      status: invoice.status,
      subTotal: invoice.subTotal,
      taxAmount: invoice.taxAmount,
      totalAmount: invoice.totalAmount,
      customerName: invoice.customerRef?.companyName,
      lines,
      readyForSale: lines.length > 0 && lines.every((l) => l.classified),
      sourceSystem: invoice.standardized?.sourceSystem ?? null,
    };
  }

  private async resolveMerchantId(complianceTenantId: string): Promise<string> {
    const tenant = await this.organization.getTenantById(complianceTenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${complianceTenantId} not found`);
    }
    if (!tenant.sync2booksCompanyId) {
      throw new BadRequestException(
        'This tenant has no sync2booksCompanyId configured — cannot resolve catalog merchantId',
      );
    }
    return tenant.sync2booksCompanyId;
  }
}
