import { DashboardSuppliersApplicationService } from './dashboard-suppliers.application.service';
import type { SupplierOrmEntity } from '../infrastructure/persistence/supplier.orm-entity';

const MERCHANT_ID = 'merchant-1';

function makeSupplier(overrides: Partial<SupplierOrmEntity> = {}): SupplierOrmEntity {
  return {
    id: 'supplier-1',
    merchantId: MERCHANT_ID,
    externalId: 'SUPP-1',
    bookId: '22',
    name: 'Kisumu Hardware Ltd',
    tin: null,
    phoneNumber: null,
    email: null,
    sourceSystem: 'QUICKBOOKS',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SupplierOrmEntity;
}

function makeService(row: SupplierOrmEntity, suppliers: unknown[]) {
  const supplierRepo = {
    findOne: jest.fn().mockImplementation(async ({ where }) =>
      row.id === where.id && row.merchantId === where.merchantId ? row : null,
    ),
    save: jest.fn().mockImplementation(async (s) => s),
  };
  const updateSupplier = jest.fn().mockResolvedValue({ erpSync: { status: 'synced' } });
  const service = new DashboardSuppliersApplicationService(
    supplierRepo as any,
    undefined as any,
    { getTenantBySync2booksCompanyId: jest.fn().mockResolvedValue({ id: 'tenant-1' }) } as any,
    {
      getForTenant: jest.fn().mockResolvedValue({
        mainApiApiKey: 'key-1',
        integrations: { quickbooks: { connectionId: 'conn-1' } },
      }),
    } as any,
    { getSuppliers: jest.fn().mockResolvedValue({ suppliers, totalPages: 1 }), updateSupplier } as any,
  );
  return { service, updateSupplier };
}

describe('DashboardSuppliersApplicationService.update -- ERP push', () => {
  it('passes a new PIN on to the ERP vendor matched by bookId', async () => {
    const { service, updateSupplier } = makeService(makeSupplier(), [
      { id: 'SUPP-OTHER', supplierName: 'Other', bookId: '5' },
      { id: 'SUPP-1', supplierName: 'Kisumu Hardware Ltd', bookId: '22' },
    ]);

    const result = await service.update(MERCHANT_ID, 'supplier-1', { tin: 'P051234567Z' });

    expect(updateSupplier).toHaveBeenCalledWith('key-1', 'SUPP-1', {
      supplierName: 'Kisumu Hardware Ltd',
      taxNumber: 'P051234567Z',
      emailAddress: undefined,
      phone: undefined,
    });
    expect(result.erp).toEqual({ status: 'updated' });
  });

  it('fails clearly when the vendor is gone from the ERP list', async () => {
    const { service, updateSupplier } = makeService(makeSupplier(), []);

    const result = await service.update(MERCHANT_ID, 'supplier-1', { name: 'Renamed Ltd' });

    expect(updateSupplier).not.toHaveBeenCalled();
    expect(result.name).toBe('Renamed Ltd');
    expect(result.erp?.status).toBe('failed');
  });
});
