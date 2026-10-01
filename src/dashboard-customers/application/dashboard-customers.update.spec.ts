import { DashboardCustomersApplicationService } from './dashboard-customers.application.service';
import type { CustomerOrmEntity } from '../infrastructure/persistence/customer.orm-entity';

const MERCHANT_ID = 'merchant-1';

function makeCustomer(overrides: Partial<CustomerOrmEntity> = {}): CustomerOrmEntity {
  return {
    id: 'customer-1',
    merchantId: MERCHANT_ID,
    externalId: '26',
    name: 'Amani Business Park Ltd',
    tin: null,
    phoneNumber: null,
    email: null,
    sourceSystem: 'QUICKBOOKS',
    taxExempt: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CustomerOrmEntity;
}

function makeService(row: CustomerOrmEntity, mainApi: { updateCustomer?: jest.Mock } = {}) {
  const customerRepo = {
    findOne: jest.fn().mockImplementation(async ({ where }) =>
      row.id === where.id && row.merchantId === where.merchantId ? row : null,
    ),
    save: jest.fn().mockImplementation(async (c) => c),
  };
  const getCustomers = jest.fn().mockResolvedValue({
    customers: [
      { id: 'QB_9', name: 'Someone else', bookId: '9' },
      { id: 'QB_26', name: 'Amani Business Park Ltd', bookId: '26' },
    ],
    totalPages: 1,
  });
  const updateCustomer =
    mainApi.updateCustomer ?? jest.fn().mockResolvedValue({ erpSync: { status: 'synced' } });
  const service = new DashboardCustomersApplicationService(
    customerRepo as any,
    undefined as any,
    { getTenantBySync2booksCompanyId: jest.fn().mockResolvedValue({ id: 'tenant-1' }) } as any,
    {
      getForTenant: jest.fn().mockResolvedValue({
        mainApiApiKey: 'key-1',
        integrations: { quickbooks: { connectionId: 'conn-1' } },
      }),
    } as any,
    { getCustomers, updateCustomer } as any,
  );
  return { service, updateCustomer, getCustomers };
}

describe('DashboardCustomersApplicationService.update -- ERP push', () => {
  it("passes a new PIN on to the ERP customer, addressed by main API's own code", async () => {
    const { service, updateCustomer } = makeService(makeCustomer());

    const result = await service.update(MERCHANT_ID, 'customer-1', { tin: 'P051234567Z' });

    expect(result.tin).toBe('P051234567Z');
    expect(updateCustomer).toHaveBeenCalledWith('key-1', 'QB_26', {
      name: 'Amani Business Park Ltd',
      taxId: 'P051234567Z',
      email: undefined,
      phone: undefined,
    });
    expect(result.erp).toEqual({ status: 'updated' });
  });

  it('keeps the local edit and reports the ERP rejection', async () => {
    const { service } = makeService(makeCustomer(), {
      updateCustomer: jest.fn().mockResolvedValue({
        erpSync: { status: 'failed', error: 'Duplicate Name Exists Error' },
      }),
    });

    const result = await service.update(MERCHANT_ID, 'customer-1', { name: 'Taken Name' });

    expect(result.name).toBe('Taken Name');
    expect(result.erp).toEqual({ status: 'failed', message: 'Duplicate Name Exists Error' });
  });

  it("doesn't call the ERP for a customer that isn't in it, or for a tax-exempt-only change", async () => {
    const notInErp = makeService(makeCustomer({ externalId: null }));
    const r1 = await notInErp.service.update(MERCHANT_ID, 'customer-1', { tin: 'P051234567Z' });

    const exemptOnly = makeService(makeCustomer());
    const r2 = await exemptOnly.service.update(MERCHANT_ID, 'customer-1', { taxExempt: true });

    expect(notInErp.updateCustomer).not.toHaveBeenCalled();
    expect(exemptOnly.updateCustomer).not.toHaveBeenCalled();
    expect(r1.erp).toBeUndefined();
    expect(r2.erp).toBeUndefined();
  });

  it('skips a customer linked to a different ERP than the one connected now', async () => {
    const { service, updateCustomer } = makeService(makeCustomer({ sourceSystem: 'ODOO' }));

    const result = await service.update(MERCHANT_ID, 'customer-1', { tin: 'P051234567Z' });

    expect(updateCustomer).not.toHaveBeenCalled();
    expect(result.erp?.status).toBe('skipped');
  });
});

describe('DashboardCustomersApplicationService.update -- retry', () => {
  it('re-sends the details on an unchanged save, so a failed ERP update can be retried', async () => {
    const { service, updateCustomer } = makeService(makeCustomer({ tin: 'P051234567Z' }));

    await service.update(MERCHANT_ID, 'customer-1', { name: 'Amani Business Park Ltd', tin: 'P051234567Z' });

    expect(updateCustomer).toHaveBeenCalledTimes(1);
  });
});
