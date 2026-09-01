import { DashboardCustomersApplicationService } from './dashboard-customers.application.service';
import type { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import type { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import type { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import type { OscuOperationsService } from '../../regulatory/oscu/presentation/oscu-operations.service';

function makeCustomerRepo() {
  const store = new Map<string, Record<string, unknown>>();
  return {
    findOne: jest
      .fn()
      .mockImplementation(({ where: { merchantId, externalId } }) =>
        Promise.resolve(
          [...store.values()].find(
            (c) => c.merchantId === merchantId && c.externalId === externalId,
          ) ?? null,
        ),
      ),
    create: jest
      .fn()
      .mockImplementation((entity: Record<string, unknown>) => entity),
    save: jest.fn().mockImplementation((entity: Record<string, unknown>) => {
      store.set(entity.id as string, entity);
      return Promise.resolve(entity);
    }),
    _store: store,
  };
}

function makeService(customerRepo: ReturnType<typeof makeCustomerRepo>) {
  const mainApiConnections = {
    getForTenant: jest.fn().mockResolvedValue({
      mainApiApiKey: 'key-1',
      integrations: { quickbooks: { connectionId: 'conn-1' } },
    }),
    resolveMerchantId: jest.fn().mockResolvedValue('merchant-1'),
  };
  const mainApiPull = {
    syncCustomersFromBookkeeping: jest.fn().mockResolvedValue(undefined),
    getCustomers: jest.fn().mockResolvedValue({
      customers: [
        {
          // Main API's own record id -- prefixed per ERP, NOT the raw id a
          // pulled invoice's customerRef.id carries.
          id: 'QB_13',
          bookId: '13',
          name: 'Attachment Flow Test Ltd',
          companyName: 'Attachment Flow Test Ltd',
          taxId: 'P012345678A',
          phone: '0712345678',
          email: 'attach-test-qb@example.com',
          standardized: { sourceSystem: 'QUICKBOOKS' },
        },
      ],
      total: 1,
      page: 1,
      limit: 100,
      totalPages: 1,
    }),
  };

  return new DashboardCustomersApplicationService(
    customerRepo as unknown as never,
    {} as OscuOperationsService,
    {
      resolveMerchantId: jest.fn(),
    } as unknown as ComplianceOrganizationApplicationService,
    mainApiConnections as unknown as MainApiConnectionApplicationService,
    mainApiPull as unknown as MainApiPullClient,
  );
}

describe('DashboardCustomersApplicationService.pullCustomers', () => {
  /**
   * Regression (2026-09-01): main API returns its own record id as
   * `customerCode` (prefixed per ERP, e.g. "QB_13") under the `id` field on
   * GET /customers -- NOT the raw ERP id. A pulled invoice's
   * `customerRef.id` is that raw, unprefixed id instead (main API's
   * invoice.service.ts assigns it straight from QuickBooks'
   * `CustomerRef.value`). Storing `externalId: mainApiCustomer.id` meant
   * dashboard_customers.externalId ("QB_13") could never match a pulled
   * invoice's customerRef.id ("13"), so
   * DashboardInvoicesApplicationService.enrich()'s customer match always
   * missed for every already-pulled customer -- confirmed live. Must store
   * `bookId` (the raw id) instead, mirroring MainApiSupplier.bookId's
   * identical, already-correct pattern.
   */
  it('stores the raw ERP bookId as externalId, not the prefixed customerCode', async () => {
    const customerRepo = makeCustomerRepo();
    const service = makeService(customerRepo);

    await service.pullCustomers('tenant-1');

    const saved = [...customerRepo._store.values()][0];
    expect(saved.externalId).toBe('13');
    expect(saved.externalId).not.toBe('QB_13');
  });

  it('re-pull updates the existing row (matched by the raw bookId) instead of creating a duplicate', async () => {
    const customerRepo = makeCustomerRepo();
    const service = makeService(customerRepo);

    await service.pullCustomers('tenant-1');
    await service.pullCustomers('tenant-1');

    expect(customerRepo._store.size).toBe(1);
  });
});
