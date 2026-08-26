import { DashboardInvoicesApplicationService } from './dashboard-invoices.application.service';
import type { CatalogService } from '../../catalog/api/catalog.service';
import type { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import type { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import type { MainApiConnection } from '../../integration/main-api-pull/domain/entities/main-api-connection.entity';
import type {
  MainApiInvoice,
  MainApiPullClient,
} from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import type { PlatformOscuCallbackService } from '../../integration/platform-outbound/platform-oscu-callback.service';
import type { Sync2BooksCorrelationPersistenceService } from '../../integration/platform-outbound/sync2books-correlation-persistence.service';
import type { Sync2BooksMainApiOscuClient } from '../../integration/platform-outbound/sync2books-main-api-oscu.client';
import type { SalesService } from '../../sales/application/sales.service';
import type { IPaymentTypeResolver } from '../../regulatory/oscu/domain/ports/payment-type-resolver.port';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';

/**
 * Minimal fakes covering only what `createSaleFromInvoice` (fresh-document,
 * submit path) and `uploadReceiptToSource` actually touch. Everything else
 * on these services is stubbed out and never expected to be called by the
 * scenarios below.
 */
function makeInvoice(): MainApiInvoice {
  return {
    id: 'invoice-1',
    invoiceCode: 'INV-001',
    reference: 'INV-001',
    issueDate: '2026-08-20T00:00:00.000Z',
    currency: 'KES',
    status: 'open',
    subTotal: 100,
    taxAmount: 16,
    totalAmount: 116,
    lineItems: [
      {
        description: 'Widget',
        unitAmount: 100,
        quantity: 1,
        itemRef: { id: 'ext-item-1', name: 'Widget' },
      },
    ],
    standardized: null,
  };
}

function makeConnection(
  autoUploadReceiptToSource: boolean,
): MainApiConnection {
  return {
    id: 'conn-1',
    complianceTenantId: 'tenant-1',
    mainApiApplicationId: 'app-1',
    mainApiApiKey: 'key-1',
    mainApiCompanyId: 'company-1',
    integrations: {},
    webhookEndpointId: null,
    webhookSecret: null,
    lastWebhookEventId: null,
    autoUploadReceiptToSource,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

type Deps = {
  catalog: Pick<CatalogService, 'getItemById' | 'findByExternalId'>;
  organization: Pick<
    ComplianceOrganizationApplicationService,
    'getTenantById' | 'listBranches'
  >;
  mainApiConnections: Pick<MainApiConnectionApplicationService, 'getForTenant'>;
  mainApiPull: Pick<MainApiPullClient, 'getInvoiceById'>;
  sales: Pick<
    SalesService,
    | 'createDocument'
    | 'submitDraftDocument'
    | 'getNormalizedSaleReport'
    | 'getDocumentBySourceInvoiceId'
    | 'patchSourceInvoiceLink'
  >;
  oscuCallback: Pick<PlatformOscuCallbackService, 'postOutcomeWithCorrelation'>;
  correlationPersistence: Pick<
    Sync2BooksCorrelationPersistenceService,
    'patchComplianceDocument' | 'patchMainApiSyncRef'
  >;
  mainApiOscuClient: Pick<Sync2BooksMainApiOscuClient, 'postInvoiceReceipt'>;
  paymentTypeResolver: IPaymentTypeResolver;
};

function makeService(deps: Deps): DashboardInvoicesApplicationService {
  return new DashboardInvoicesApplicationService(
    deps.catalog as CatalogService,
    deps.organization as ComplianceOrganizationApplicationService,
    deps.mainApiConnections as MainApiConnectionApplicationService,
    deps.mainApiPull as MainApiPullClient,
    deps.sales as SalesService,
    deps.oscuCallback as PlatformOscuCallbackService,
    deps.correlationPersistence as Sync2BooksCorrelationPersistenceService,
    deps.mainApiOscuClient as Sync2BooksMainApiOscuClient,
    deps.paymentTypeResolver,
  );
}

/** Defaults sufficient to drive `createSaleFromInvoice` through its fresh-document + submit path. */
function defaultDeps(autoUploadReceiptToSource: boolean): Deps & {
  postInvoiceReceipt: jest.Mock;
  patchMainApiSyncRef: jest.Mock;
} {
  const postInvoiceReceipt = jest.fn().mockResolvedValue({
    syncItemId: 'sync-item-1',
    syncBatchId: 'sync-batch-1',
    status: 'pending',
  });
  const patchMainApiSyncRef = jest.fn().mockResolvedValue(undefined);

  return {
    catalog: {
      getItemById: async (id: string) =>
        ({
          id,
          name: 'Widget',
          taxCategory: TaxCategory.VAT_STANDARD,
        }) as Awaited<ReturnType<CatalogService['getItemById']>>,
      findByExternalId: async (_merchantId, externalId) =>
        ({ id: `catalog-${externalId}` }) as Awaited<
          ReturnType<CatalogService['findByExternalId']>
        >,
    },
    organization: {
      getTenantById: async (id: string) =>
        ({ id, sync2booksCompanyId: 'merchant-1', displayName: 'Tenant' }) as Awaited<
          ReturnType<ComplianceOrganizationApplicationService['getTenantById']>
        >,
      listBranches: async () =>
        [{ id: 'branch-1' }] as Awaited<
          ReturnType<ComplianceOrganizationApplicationService['listBranches']>
        >,
    },
    mainApiConnections: {
      getForTenant: async () => makeConnection(autoUploadReceiptToSource),
    },
    mainApiPull: {
      getInvoiceById: async () => makeInvoice(),
    },
    sales: {
      createDocument: async () =>
        ({
          created: true,
          document: { id: 'doc-1' },
        }) as Awaited<ReturnType<SalesService['createDocument']>>,
      submitDraftDocument: async () =>
        ({}) as Awaited<ReturnType<SalesService['submitDraftDocument']>>,
      getNormalizedSaleReport: async () =>
        ({ id: 'doc-1' }) as Awaited<
          ReturnType<SalesService['getNormalizedSaleReport']>
        >,
      getDocumentBySourceInvoiceId: async () => null,
      patchSourceInvoiceLink: async () => undefined,
    },
    oscuCallback: {
      postOutcomeWithCorrelation: async () => undefined,
    },
    correlationPersistence: {
      patchComplianceDocument: async () => undefined,
      patchMainApiSyncRef,
    },
    mainApiOscuClient: {
      postInvoiceReceipt,
    },
    paymentTypeResolver: {
      resolve: async () => '02',
    },
    postInvoiceReceipt,
    patchMainApiSyncRef,
  };
}

describe('DashboardInvoicesApplicationService — receipt push-back toggle', () => {
  it('skips the automatic invoice-receipt notification when autoUploadReceiptToSource is false', async () => {
    const deps = defaultDeps(false);
    const service = makeService(deps);

    await service.createSaleFromInvoice('tenant-1', 'invoice-1');

    expect(deps.postInvoiceReceipt).not.toHaveBeenCalled();
    expect(deps.patchMainApiSyncRef).not.toHaveBeenCalled();
  });

  it('still auto-notifies when autoUploadReceiptToSource is true (the default)', async () => {
    const deps = defaultDeps(true);
    const service = makeService(deps);

    await service.createSaleFromInvoice('tenant-1', 'invoice-1');

    expect(deps.postInvoiceReceipt).toHaveBeenCalledTimes(1);
    expect(deps.postInvoiceReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceInvoiceId: 'invoice-1',
        companyId: 'company-1',
        complianceDocumentId: 'doc-1',
      }),
    );
    expect(deps.patchMainApiSyncRef).toHaveBeenCalledWith(
      'doc-1',
      'sync-item-1',
      'sync-batch-1',
    );
  });

  it('the manual upload-receipt route notifies Main API regardless of the toggle state', async () => {
    const deps = defaultDeps(false);
    // uploadReceiptToSource looks the sale up by source-invoice id directly —
    // no need for the full pull/catalog/branch machinery createSaleFromInvoice uses.
    deps.sales.getDocumentBySourceInvoiceId = async () =>
      ({
        id: 'doc-1',
        mainApiSyncItemId: null,
      }) as Awaited<ReturnType<SalesService['getDocumentBySourceInvoiceId']>>;
    const service = makeService(deps);

    await service.uploadReceiptToSource('tenant-1', 'invoice-1');

    expect(deps.postInvoiceReceipt).toHaveBeenCalledTimes(1);
    expect(deps.patchMainApiSyncRef).toHaveBeenCalledWith(
      'doc-1',
      'sync-item-1',
      'sync-batch-1',
    );
  });

  it('uploadReceiptToSource throws when no sale has been created from this invoice yet', async () => {
    const deps = defaultDeps(false);
    deps.sales.getDocumentBySourceInvoiceId = async () => null;
    const service = makeService(deps);

    await expect(
      service.uploadReceiptToSource('tenant-1', 'invoice-1'),
    ).rejects.toThrow('No sale has been created from this invoice yet');
    expect(deps.postInvoiceReceipt).not.toHaveBeenCalled();
  });
});
