import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CatalogService } from '../../catalog/api/catalog.service';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import {
  MainApiPullClient,
  type MainApiInvoice,
} from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { SalesService } from '../../sales/application/sales.service';
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
};

@Injectable()
export class DashboardInvoicesApplicationService {
  private readonly logger = new Logger(DashboardInvoicesApplicationService.name);

  constructor(
    private readonly catalog: CatalogService,
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
    private readonly sales: SalesService,
  ) {}

  async pullInvoices(
    complianceTenantId: string,
    params: { page?: number; limit?: number } = {},
  ) {
    const connection = await this.mainApiConnections.getForTenant(complianceTenantId);

    const quickbooksConnectionId = connection.integrations['quickbooks']?.connectionId;
    if (quickbooksConnectionId) {
      try {
        await this.mainApiPull.syncInvoicesFromBookkeeping(
          connection.mainApiApiKey,
          quickbooksConnectionId,
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
    params: { page?: number; limit?: number } = {},
  ) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const connection = await this.mainApiConnections.getForTenant(complianceTenantId);

    const response = await this.mainApiPull.getInvoices(connection.mainApiApiKey, params);
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
    const connection = await this.mainApiConnections.getForTenant(complianceTenantId);

    const invoice = await this.mainApiPull.getInvoiceById(
      connection.mainApiApiKey,
      mainApiInvoiceId,
    );
    return this.enrich(merchantId, invoice);
  }

  /**
   * Creates (and by default submits to eTIMS) a Sale from a pulled invoice.
   * Every line's item must already be registered+classified in the catalog —
   * this never auto-registers items, matching the deliberate two-step flow
   * (classify first, then sell) called for by the dashboard's workflow.
   */
  async createSaleFromInvoice(
    complianceTenantId: string,
    mainApiInvoiceId: string,
    options: { submit?: boolean } = {},
  ) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const pulled = await this.getInvoiceById(complianceTenantId, mainApiInvoiceId);

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

    const lines = await Promise.all(
      pulled.lines.map(async (line) => {
        const catalogItem = await this.catalog.getItemById(line.catalogItemId as string);
        if (!catalogItem) {
          throw new BadRequestException(
            `Catalog item ${line.catalogItemId} no longer exists`,
          );
        }
        return {
          itemId: catalogItem.id,
          description: line.description ?? catalogItem.name,
          quantity: line.quantity,
          unitPrice: line.unitAmount,
          taxCategory: catalogItem.taxCategory,
          taxAmount: line.taxAmount ?? 0,
        };
      }),
    );

    const createResult = await this.sales.createDocument(
      {
        merchantId,
        branchId: branch.id,
        sourceSystem: SourceSystem.API,
        sourceDocumentId: pulled.invoiceCode,
        documentType: DocumentType.SALE,
        documentNumber: pulled.reference ?? pulled.invoiceCode,
        originalDocumentNumber: null,
        originalSaleId: null,
        creditNoteDate: null,
        creditNoteReasonCode: null,
        saleDate: pulled.issueDate.slice(0, 10),
        // TODO: no reliable QuickBooks-side signal for payment method/status yet —
        // '01' (cash) / '02' are the same MVP defaults DashboardSalesController
        // uses for manually-entered sales. Revisit once a payment-type mapping exists.
        receiptTypeCode: 'S',
        paymentTypeCode: '01',
        invoiceStatusCode: '02',
        currency: pulled.currency || 'KES',
        exchangeRate: 1,
        subtotalAmount: lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
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
      await this.sales.applyInventoryMovements(documentId);

      const validation = await this.sales.validateDocument(documentId);
      if (!validation.validation.isValid) {
        throw new BadRequestException({
          message: 'Sale validation failed',
          errors: validation.validation.errors,
        });
      }

      await this.sales.prepareDocument(documentId);
      await this.sales.submitDocument(documentId);
    }

    return this.sales.getNormalizedSaleReport(documentId);
  }

  private async enrich(merchantId: string, invoice: MainApiInvoice): Promise<PulledInvoice> {
    const lines = await Promise.all(
      invoice.lineItems.map(async (line) => {
        const itemExternalId = line.itemRef?.id ?? null;
        const catalogItem = itemExternalId
          ? await this.catalog.findByExternalId(merchantId, itemExternalId)
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
