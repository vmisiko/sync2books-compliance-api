import { NotFoundException } from '@nestjs/common';
import { DashboardCustomersApplicationService } from './dashboard-customers.application.service';
import type { CustomerOrmEntity } from '../infrastructure/persistence/customer.orm-entity';

const TENANT_ID = 'tenant-1';
const MERCHANT_ID = 'merchant-1';

function makeCustomer(overrides: Partial<CustomerOrmEntity> = {}): CustomerOrmEntity {
  return {
    id: 'customer-1',
    merchantId: MERCHANT_ID,
    externalId: null,
    name: 'Amani Business Park Ltd',
    tin: 'P051234567A',
    phoneNumber: null,
    email: null,
    sourceSystem: null,
    taxExempt: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CustomerOrmEntity;
}

function makeService(opts: {
  rows: CustomerOrmEntity[];
  integrations?: Record<string, { connectionId: string | null }>;
  erpCustomers?: unknown[] | unknown[][];
  createCustomer?: jest.Mock;
}) {
  // Scoped the way the real repo is: a row only comes back for its own merchant.
  const customerRepo = {
    findOne: jest.fn().mockImplementation(async ({ where }) =>
      opts.rows.find((r) => r.id === where.id && r.merchantId === where.merchantId) ?? null,
    ),
    save: jest.fn().mockImplementation(async (c) => c),
    create: jest.fn().mockImplementation((c) => ({ ...c })),
  };
  const mainApiConnections = {
    resolveMerchantId: jest.fn().mockResolvedValue(MERCHANT_ID),
    getForTenant: jest.fn().mockResolvedValue({
      mainApiApiKey: 'key-1',
      integrations: opts.integrations ?? { quickbooks: { connectionId: 'conn-1' } },
    }),
  };
  const organization = {
    getTenantBySync2booksCompanyId: jest.fn().mockResolvedValue({ id: TENANT_ID }),
  };
  const pages = (
    Array.isArray(opts.erpCustomers?.[0]) ? opts.erpCustomers : [opts.erpCustomers ?? []]
  ) as unknown[][];
  let call = 0;
  const getCustomers = jest.fn().mockImplementation(async () => ({
    customers: pages[Math.min(call++, pages.length - 1)],
    totalPages: 1,
  }));
  const createCustomer =
    opts.createCustomer ??
    jest.fn().mockResolvedValue({
      customer: { id: 'QB_77', bookId: '77', syncStatus: 'synced' },
      syncedToBookkeeping: true,
      syncBatchId: 'b1',
      message: 'ok',
    });
  const syncCustomersFromBookkeeping = jest.fn().mockResolvedValue(undefined);

  const service = new DashboardCustomersApplicationService(
    customerRepo as any,
    undefined as any,
    organization as any,
    mainApiConnections as any,
    { getCustomers, createCustomer, syncCustomersFromBookkeeping } as any,
  );
  return { service, customerRepo, createCustomer, getCustomers, syncCustomersFromBookkeeping, organization };
}

describe('DashboardCustomersApplicationService.ensureInErp', () => {
  it('treats a customer that already has an ERP id (externalId) as linked without calling the ERP', async () => {
    const { service, createCustomer, getCustomers } = makeService({
      rows: [makeCustomer({ externalId: '14', sourceSystem: 'QUICKBOOKS' })],
    });

    const result = await service.ensureInErp(TENANT_ID, 'customer-1');

    expect(result).toEqual(expect.objectContaining({ status: 'linked', created: false }));
    expect(getCustomers).not.toHaveBeenCalled();
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it('adopts the ERP customer with the same PIN, storing its raw ERP id as externalId', async () => {
    const customer = makeCustomer();
    const { service, createCustomer } = makeService({
      rows: [customer],
      erpCustomers: [{ id: 'QB_14', bookId: '14', name: 'Amani Biz Park', taxId: 'p051234567a' }],
    });

    const result = await service.ensureInErp(TENANT_ID, 'customer-1');

    expect(createCustomer).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ status: 'linked', created: false }));
    // The raw ERP id -- what invoice enrichment matches customerRef.id against -- not QB_14.
    expect(customer.externalId).toBe('14');
    expect(customer.sourceSystem).toBe('QUICKBOOKS');
  });

  it('creates the customer in the ERP when nothing matches', async () => {
    const customer = makeCustomer();
    const { service, createCustomer } = makeService({ rows: [customer] });

    const result = await service.ensureInErp(TENANT_ID, 'customer-1');

    expect(createCustomer).toHaveBeenCalledWith('key-1', 'conn-1', {
      name: 'Amani Business Park Ltd',
      taxId: 'P051234567A',
      email: undefined,
      phone: undefined,
      currency: 'KES',
    });
    expect(result).toEqual(expect.objectContaining({ status: 'linked', created: true }));
    expect(customer.externalId).toBe('77');
  });

  it('refreshes and adopts after a duplicate-name rejection', async () => {
    const customer = makeCustomer();
    const { service, syncCustomersFromBookkeeping } = makeService({
      rows: [customer],
      createCustomer: jest.fn().mockResolvedValue({
        customer: { id: 'x', syncStatus: 'pending' },
        syncedToBookkeeping: false,
        syncError: 'Duplicate Name Exists Error',
        syncBatchId: 'b1',
        message: 'failed',
      }),
      erpCustomers: [[], [{ id: 'QB_20', bookId: '20', name: 'AMANI BUSINESS PARK LTD' }]],
    });

    const result = await service.ensureInErp(TENANT_ID, 'customer-1');

    expect(syncCustomersFromBookkeeping).toHaveBeenCalled();
    expect(result.status).toBe('linked');
    expect(customer.externalId).toBe('20');
  });

  it('skips when no ERP is connected', async () => {
    const { service } = makeService({
      rows: [makeCustomer()],
      integrations: { quickbooks: { connectionId: null } },
    });

    expect((await service.ensureInErp(TENANT_ID, 'customer-1')).status).toBe('skipped');
  });
});

describe('DashboardCustomersApplicationService.syncManyToErp', () => {
  it('reports each customer, and never touches a customer of another business', async () => {
    const mine = makeCustomer();
    const theirs = makeCustomer({ id: 'customer-2', merchantId: 'merchant-2', name: 'Other Co' });
    const { service, createCustomer } = makeService({ rows: [mine, theirs] });

    const results = await service.syncManyToErp(TENANT_ID, ['customer-1', 'customer-2']);

    expect(results[0]).toEqual(
      expect.objectContaining({ id: 'customer-1', status: 'linked', created: true }),
    );
    expect(results[1]).toEqual(expect.objectContaining({ id: 'customer-2', status: 'failed' }));
    expect(createCustomer).toHaveBeenCalledTimes(1);
    expect(theirs.externalId).toBeNull();
  });
});

describe('DashboardCustomersApplicationService.createWithErp', () => {
  it('only pushes to the ERP when syncToErp is set', async () => {
    const rows: CustomerOrmEntity[] = [];
    const { service, createCustomer, customerRepo } = makeService({ rows });
    customerRepo.save.mockImplementation(async (c: CustomerOrmEntity) => {
      if (!rows.includes(c)) rows.push(c);
      return c;
    });

    const plain = await service.createWithErp({ merchantId: MERCHANT_ID, name: 'Walk-in' });
    expect(plain).not.toHaveProperty('erp');
    expect(createCustomer).not.toHaveBeenCalled();

    const synced = await service.createWithErp({
      merchantId: MERCHANT_ID,
      name: 'Grace Wanjiru',
      syncToErp: true,
    });
    expect(synced.erp).toEqual({ status: 'linked', created: true, message: undefined });
    expect(synced.externalId).toBe('77');
  });

  it('rejects a merchant with no tenant', async () => {
    const { service, organization } = makeService({ rows: [] });
    organization.getTenantBySync2booksCompanyId.mockResolvedValue(null);

    await expect(service.ensureInErpForMerchant('nope', 'customer-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
