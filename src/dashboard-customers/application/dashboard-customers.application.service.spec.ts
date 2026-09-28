import { NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
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

/**
 * `taxExempt` drives the default "Invoice Type" on Add Sale (see
 * `InvoiceType.EXEMPT` / `applyInvoiceTypeOverride`) -- a manual/edit-only
 * flag, never set by an ERP pull, so this is covered separately from the
 * pull fixtures above.
 */
describe('DashboardCustomersApplicationService taxExempt', () => {
  function makeByIdRepo() {
    const store = new Map<string, Record<string, unknown>>();
    return {
      findOne: jest.fn().mockImplementation(({ where: { id, merchantId } }) =>
        Promise.resolve(
          [...store.values()].find(
            (c) => c.id === id && c.merchantId === merchantId,
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

  function makeCreateUpdateService(customerRepo: ReturnType<typeof makeByIdRepo>) {
    return new DashboardCustomersApplicationService(
      customerRepo as unknown as never,
      {} as OscuOperationsService,
      { resolveMerchantId: jest.fn() } as unknown as ComplianceOrganizationApplicationService,
      {} as unknown as MainApiConnectionApplicationService,
      {} as unknown as MainApiPullClient,
    );
  }

  it('defaults a new customer to not tax-exempt', async () => {
    const repo = makeByIdRepo();
    const service = makeCreateUpdateService(repo);

    const created = await service.create({ merchantId: 'merchant-1', name: 'Karibu Wholesalers' });

    expect(created.taxExempt).toBe(false);
  });

  it('creates a customer flagged tax-exempt', async () => {
    const repo = makeByIdRepo();
    const service = makeCreateUpdateService(repo);

    const created = await service.create({
      merchantId: 'merchant-1',
      name: 'Kenya Red Cross',
      taxExempt: true,
    });

    expect(created.taxExempt).toBe(true);
  });

  it('updates the flag on an existing customer', async () => {
    const repo = makeByIdRepo();
    const service = makeCreateUpdateService(repo);
    const created = await service.create({ merchantId: 'merchant-1', name: 'Kenya Red Cross' });

    const updated = await service.update('merchant-1', created.id, { taxExempt: true });

    expect(updated.taxExempt).toBe(true);
  });

  // `??` (not `||`), so an explicit `false` overrides an existing `true`
  // rather than being read as "not supplied".
  it('can turn the flag back off', async () => {
    const repo = makeByIdRepo();
    const service = makeCreateUpdateService(repo);
    const created = await service.create({ merchantId: 'merchant-1', name: 'Kenya Red Cross', taxExempt: true });

    const updated = await service.update('merchant-1', created.id, { taxExempt: false });

    expect(updated.taxExempt).toBe(false);
  });

  it('leaves the flag alone when not mentioned in the update', async () => {
    const repo = makeByIdRepo();
    const service = makeCreateUpdateService(repo);
    const created = await service.create({ merchantId: 'merchant-1', name: 'Kenya Red Cross', taxExempt: true });

    const updated = await service.update('merchant-1', created.id, { name: 'Kenya Red Cross Society' });

    expect(updated.taxExempt).toBe(true);
  });
});

describe('DashboardCustomersApplicationService.delete', () => {
  /**
   * In-memory repo that honours the `deletedAt: IsNull()` filter and the
   * list() query builder's `deletedAt IS NULL` clause -- the parts under test.
   */
  function makeSoftDeleteRepo() {
    const store = new Map<string, Record<string, unknown>>();
    const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
      Object.entries(where).every(([key, value]) =>
        value instanceof FindOperator
          ? value.type === 'isNull' && row[key] == null
          : row[key] === value,
      );
    return {
      findOne: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve([...store.values()].find((row) => matches(row, where)) ?? null),
      ),
      create: jest.fn().mockImplementation((entity: Record<string, unknown>) => entity),
      save: jest.fn().mockImplementation((entity: Record<string, unknown>) => {
        store.set(entity.id as string, entity);
        return Promise.resolve(entity);
      }),
      createQueryBuilder: jest.fn().mockImplementation(() => {
        const clauses: string[] = [];
        let merchantId: string | undefined;
        const qb = {
          where: (_sql: string, params: { merchantId: string }) => {
            merchantId = params.merchantId;
            return qb;
          },
          andWhere: (sql: string) => {
            clauses.push(sql);
            return qb;
          },
          orderBy: () => qb,
          getMany: () =>
            Promise.resolve(
              [...store.values()].filter(
                (row) =>
                  row.merchantId === merchantId &&
                  (!clauses.includes('c.deletedAt IS NULL') || row.deletedAt == null),
              ),
            ),
        };
        return qb;
      }),
      _store: store,
    };
  }

  function makeDeleteService(customerRepo: ReturnType<typeof makeSoftDeleteRepo>) {
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
            id: 'QB_14',
            bookId: '14',
            name: 'Amani Business Park Ltd',
            companyName: 'Amani Business Park Ltd',
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
      { resolveMerchantId: jest.fn() } as unknown as ComplianceOrganizationApplicationService,
      mainApiConnections as unknown as MainApiConnectionApplicationService,
      mainApiPull as unknown as MainApiPullClient,
    );
  }

  it('removes the customer from the list but keeps the row (soft delete)', async () => {
    const repo = makeSoftDeleteRepo();
    const service = makeDeleteService(repo);
    const kept = await service.create({ merchantId: 'merchant-1', name: 'Kenya Red Cross' });
    const gone = await service.create({ merchantId: 'merchant-1', name: 'UI Test Exempt Customer' });

    const deleted = await service.delete('merchant-1', gone.id);

    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(repo._store.has(gone.id)).toBe(true);
    const listed = await service.list('merchant-1');
    expect(listed.map((c) => c.id)).toEqual([kept.id]);
  });

  it("refuses another merchant's customer", async () => {
    const repo = makeSoftDeleteRepo();
    const service = makeDeleteService(repo);
    const other = await service.create({ merchantId: 'merchant-2', name: 'Not Yours Ltd' });

    await expect(service.delete('merchant-1', other.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo._store.get(other.id)?.deletedAt ?? null).toBeNull();
  });

  it('refuses a second delete and edits of a deleted customer', async () => {
    const repo = makeSoftDeleteRepo();
    const service = makeDeleteService(repo);
    const created = await service.create({ merchantId: 'merchant-1', name: 'Grace Wanjiru' });
    await service.delete('merchant-1', created.id);

    await expect(service.delete('merchant-1', created.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.update('merchant-1', created.id, { name: 'Grace W.' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a later ERP pull leaves a deleted customer deleted instead of re-creating it', async () => {
    const repo = makeSoftDeleteRepo();
    const service = makeDeleteService(repo);
    await service.pullCustomers('tenant-1');
    const [pulled] = [...repo._store.values()];
    await service.delete('merchant-1', pulled.id as string);

    const result = await service.pullCustomers('tenant-1');

    expect(repo._store.size).toBe(1);
    expect(repo._store.get(pulled.id as string)?.deletedAt).toBeInstanceOf(Date);
    expect(result.results).toEqual([]);
    expect(await service.list('merchant-1')).toEqual([]);
  });

  it('pulled-invoice matching no longer finds a deleted customer', async () => {
    const repo = makeSoftDeleteRepo();
    const service = makeDeleteService(repo);
    await service.pullCustomers('tenant-1');
    const [pulled] = [...repo._store.values()];
    await service.delete('merchant-1', pulled.id as string);

    expect(await service.findByExternalId('merchant-1', '14', 'QUICKBOOKS')).toBeNull();
  });
});
