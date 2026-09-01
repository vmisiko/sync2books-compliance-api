import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { CatalogService } from '../../catalog/api/catalog.service';
import { DashboardCustomersApplicationService } from '../../dashboard-customers/application/dashboard-customers.application.service';
import { InsufficientStockError } from '../../inventory/domain/errors/insufficient-stock.error';
import { ItemNotReadyForEtimsError } from '../../sales/domain/errors/item-not-ready-for-etims.error';
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
  /** True only once the matched catalog item has actually been synced to KRA via saveItem (registrationStatus === 'REGISTERED') -- a classified item can still be PENDING/FAILED here, since classification and KRA registration are separate steps (see sync-items.usecase.ts). */
  registered: boolean;
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
  /** Matched by customerRef.id against this merchant's already-pulled customers -- null if this ERP customer hasn't been pulled/stored here yet. */
  customerId?: string | null;
  customerPin?: string | null;
  customerPhoneNumber?: string | null;
  customerEmail?: string | null;
  lines: PulledInvoiceLine[];
  /** false if any line's item hasn't been classified or registered (synced to KRA) in the catalog yet. */
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
    private readonly customers: DashboardCustomersApplicationService,
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

    // `source` is this method's own param (the dashboard's ERP selector,
    // already consumed above by resolveInvoicePullSource) -- it isn't part
    // of listInvoices'/getInvoices' declared params, so pick only those out
    // explicitly rather than forwarding the whole `params` object through.
    // Forwarding it whole was leaking `source` onto the actual GET /invoices
    // query string sent to main API, which 400s ("property source should
    // not exist") since its DTO doesn't whitelist it.
    const { page, limit, startDate, endDate } = params;
    const result = await this.listInvoices(complianceTenantId, {
      page,
      limit,
      startDate,
      endDate,
    });

    // Surface the classification/registration gate right here, at pull time,
    // instead of only when a user opens each invoice individually and hits
    // create-sale's 400 (see createSaleFromInvoice below, which throws the
    // same unclassifiedItems/unregisteredItems shape one invoice at a time).
    // Invoices themselves are still pulled and listed either way -- this is
    // a summary on top, not a filter -- so nothing here blocks the pull.
    const blockedInvoices = result.data
      .filter((invoice) => !invoice.readyForSale)
      .map((invoice) => {
        const { unclassifiedItems, unregisteredItems } =
          this.getBlockingItems(invoice);
        return {
          mainApiInvoiceId: invoice.mainApiInvoiceId,
          invoiceCode: invoice.invoiceCode,
          unclassifiedItems,
          unregisteredItems,
        };
      });

    return {
      ...result,
      summary: {
        pulled: result.data.length,
        readyForSale: result.data.length - blockedInvoices.length,
        blocked: blockedInvoices.length,
        blockedInvoices,
      },
    };
  }

  /**
   * Extracts the human-readable item names blocking one pulled invoice from
   * being sold, split by reason (unclassified vs. classified-but-not-yet-
   * registered-with-KRA -- see the doc comment on the equivalent check in
   * createSaleFromInvoice for why these two must stay separate). Shared by
   * that method's 400 response and pullInvoices' batch summary so the two
   * surfaces can never drift on what counts as "blocked".
   */
  private getBlockingItems(pulled: PulledInvoice): {
    unclassifiedItems: string[];
    unregisteredItems: string[];
  } {
    const unclassifiedItems = pulled.lines
      .filter((l) => !l.classified)
      .map((l) => l.itemName ?? l.itemExternalId ?? 'unknown item');
    const unregisteredItems = pulled.lines
      .filter((l) => l.classified && !l.registered)
      .map((l) => l.itemName ?? l.itemExternalId ?? 'unknown item');
    return { unclassifiedItems, unregisteredItems };
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
   *
   * `customerPin`/`customerName`/`customerPhoneNumber`/`customerEmail` and
   * `lineOverrides` (description/quantity/unitAmount, keyed by the pulled
   * invoice's own line index) let the dashboard correct what the ERP pull
   * carried before submitting — most pulled invoices have no customer PIN
   * at all, since QuickBooks doesn't track one. Applies to this submission
   * only: the pulled invoice's own cached data and the source ERP are never
   * touched by these overrides.
   */
  async createSaleFromInvoice(
    complianceTenantId: string,
    mainApiInvoiceId: string,
    options: {
      submit?: boolean;
      customerPin?: string;
      customerName?: string;
      customerPhoneNumber?: string;
      customerEmail?: string;
      lineOverrides?: Array<{
        index: number;
        description?: string;
        quantity?: number;
        unitAmount?: number;
      }>;
    } = {},
    req?: Request,
  ) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const pulled = await this.getInvoiceById(
      complianceTenantId,
      mainApiInvoiceId,
    );

    if (!pulled.readyForSale) {
      const { unclassifiedItems: unclassified, unregisteredItems: unregistered } =
        this.getBlockingItems(pulled);
      const reasons: string[] = [];
      if (unclassified.length) {
        reasons.push(
          `unclassified items (classify them via POST /dashboard-api/items/pull, then PATCH classification): ${unclassified.join(', ')}`,
        );
      }
      if (unregistered.length) {
        reasons.push(
          `items not yet registered with KRA (sync them from Item Sync first): ${unregistered.join(', ')}`,
        );
      }
      throw new BadRequestException({
        message: `This invoice cannot be sold yet — ${reasons.join('; ')}`,
        unclassifiedItems: unclassified,
        unregisteredItems: unregistered,
      });
    }

    // Mode B branch resolution — see
    // ComplianceOrganizationApplicationService.resolveDashboardBranchId's doc
    // comment.
    const branchId =
      await this.organization.resolveDashboardBranchId(complianceTenantId);

    const lines = await Promise.all(
      pulled.lines.map(async (line, index) => {
        const catalogItem = await this.catalog.getItemById(
          line.catalogItemId as string,
        );
        if (!catalogItem) {
          throw new BadRequestException(
            `Catalog item ${line.catalogItemId} no longer exists`,
          );
        }
        // Dashboard-supplied correction for this one submission -- the
        // pulled invoice's own cached line and the source ERP are untouched.
        const override = options.lineOverrides?.find((o) => o.index === index);
        const quantity = override?.quantity ?? line.quantity;
        const unitAmount = override?.unitAmount ?? line.unitAmount;
        // Don't trust the pulled line's own taxAmount -- QuickBooks (and
        // likely other ERPs) only total tax at the invoice header
        // (TxnTaxDetail), never per SalesItemLine, so it's reliably absent
        // here. Compute it the same way SalesService's tax-rule engine will
        // validate it, from the catalog item's actual taxCategory, so this
        // never submits a line doomed to fail TAX_VAT_STANDARD_RATE/TAX_VAT_8_RATE.
        return {
          itemId: catalogItem.id,
          description:
            override?.description ?? line.description ?? catalogItem.name,
          quantity,
          unitPrice: unitAmount,
          taxCategory: catalogItem.taxCategory,
          taxAmount: expectedTaxAmount(
            catalogItem.taxCategory,
            quantity,
            unitAmount,
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
        branchId,
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
        customerPin: options.customerPin ?? pulled.customerPin ?? null,
        customerName: options.customerName ?? pulled.customerName ?? null,
        customerPhoneNumber:
          options.customerPhoneNumber ?? pulled.customerPhoneNumber ?? null,
        customerEmail: options.customerEmail ?? pulled.customerEmail ?? null,
        lines,
      },
      { enqueueProcessing: false },
    );

    const documentId = (createResult.document as { id: string }).id;
    const shouldSubmit = options.submit ?? true;

    // InsufficientStockError (thrown deep inside SalesService.
    // applyInventoryMovements -> InventoryService.recordMovement, for a
    // stock item this merchant hasn't recorded any stock for yet) was
    // reaching the controller uncaught, surfacing as a bare "Internal
    // server error" 500 instead of a clear, actionable message -- confirmed
    // live 2026-09-01. There's no global exception filter in this service
    // to convert it centrally, so catch it at this call site, the same way
    // the unclassified-items case above already gets a clear 400 instead of
    // letting the underlying failure leak out raw.
    try {
      await this.submitAndNotify(
        createResult,
        documentId,
        shouldSubmit,
        pulled,
        complianceTenantId,
        req,
      );
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        throw new BadRequestException(
          `Cannot submit this sale: ${error.message} -- add stock for this item (Inventory > Adjust Stock) before selling it, or confirm it should be tracked as a stock item at all.`,
        );
      }
      // Mirrors the InsufficientStockError case above: the readyForSale check
      // earlier in this method only reflects the catalog item's state at the
      // time of THIS request. It can't protect the idempotency-resume branch
      // below (existing DRAFT/VALIDATED document from an interrupted prior
      // attempt calling prepareDocument directly), so an item that still
      // isn't actually eTIMS-ready reaches prepareDocument uncaught and used
      // to surface as a bare 500 instead of an actionable message.
      if (error instanceof ItemNotReadyForEtimsError) {
        throw new BadRequestException(
          `Cannot submit this sale: ${error.message} -- sync this item to KRA (Item Sync) before selling it.`,
        );
      }
      throw error;
    }

    return this.sales.getNormalizedSaleReport(documentId);
  }

  private async submitAndNotify(
    createResult: { created: boolean; document: unknown },
    documentId: string,
    shouldSubmit: boolean,
    pulled: PulledInvoice,
    complianceTenantId: string,
    req: Request | undefined,
  ): Promise<void> {
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

    return this.getReceiptAttachmentStatus(
      complianceTenantId,
      mainApiInvoiceId,
    );
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
      typeof status.syncErrorMessage === 'string'
        ? status.syncErrorMessage
        : null,
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
          // Matching to *some* catalog row isn't enough -- saveItem/sales
          // submission also needs classificationCode/unitCode/
          // packagingUnitCode resolved and productTypeCode set, exactly
          // what needsClassificationMapping/needsProductType already track
          // (see sync-items.usecase.ts's own eligibility filter, which
          // skips an item for the identical reason). Without this, an item
          // matched-but-incomplete showed as "classified"/readyForSale here
          // while still failing sale validation downstream with
          // CLASSIFICATION_UNIT_REQUIRED — confirmed live 2026-08-31.
          classified: Boolean(
            catalogItem &&
            !catalogItem.needsClassificationMapping &&
            !catalogItem.needsProductType,
          ),
          registered: catalogItem?.registrationStatus === 'REGISTERED',
        };
      }),
    );

    // Matches this invoice's customer back to whatever this merchant already
    // pulled/stored on the Customers page (same externalId-matching pattern
    // as the line items above) -- lets Review Pulled Invoice reuse a PIN the
    // user already entered there instead of asking them to retype it.
    const customerExternalId = invoice.customerRef?.id ?? null;
    const matchedCustomer = customerExternalId
      ? await this.customers.findByExternalId(
          merchantId,
          customerExternalId,
          invoiceSourceSystem,
        )
      : null;

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
      customerName: matchedCustomer?.name ?? invoice.customerRef?.companyName,
      customerId: matchedCustomer?.id ?? null,
      customerPin: matchedCustomer?.tin ?? null,
      customerPhoneNumber: matchedCustomer?.phoneNumber ?? null,
      customerEmail: matchedCustomer?.email ?? null,
      lines,
      readyForSale:
        lines.length > 0 && lines.every((l) => l.classified && l.registered),
      sourceSystem: invoice.standardized?.sourceSystem ?? null,
    };
  }

  private async resolveMerchantId(complianceTenantId: string): Promise<string> {
    return this.mainApiConnections.resolveMerchantId(complianceTenantId);
  }
}
