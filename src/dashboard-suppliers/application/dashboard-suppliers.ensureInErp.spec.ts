import { DashboardSuppliersApplicationService } from './dashboard-suppliers.application.service';
import type { SupplierOrmEntity } from '../infrastructure/persistence/supplier.orm-entity';

const TENANT_ID = 'tenant-1';
const MERCHANT_ID = 'merchant-1';

function makeSupplier(overrides: Partial<SupplierOrmEntity> = {}): SupplierOrmEntity {
  return {
    id: 'supplier-1',
    merchantId: MERCHANT_ID,
    externalId: null,
    bookId: null,
    name: 'SYNC TO BOOKS RECONCILER LIMITED',
    tin: 'P052581715V',
    phoneNumber: null,
    email: null,
    sourceSystem: 'ETIMS',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SupplierOrmEntity;
}

function makeService(opts: {
  supplier: SupplierOrmEntity;
  integrations?: Record<string, { connectionId: string | null }>;
  existingVendors?: unknown[] | unknown[][];
  createSupplier?: jest.Mock;
}) {
  const supplierRepo = {
    findOne: jest.fn().mockResolvedValue(opts.supplier),
    save: jest.fn().mockImplementation(async (s) => s),
  };
  const mainApiConnections = {
    resolveMerchantId: jest.fn().mockResolvedValue(MERCHANT_ID),
    getForTenant: jest.fn().mockResolvedValue({
      mainApiApiKey: 'key-1',
      integrations: opts.integrations ?? { quickbooks: { connectionId: 'conn-1' } },
    }),
  };
  // One vendor list per getSuppliers call (so a test can model a refresh).
  const pages = (
    Array.isArray(opts.existingVendors?.[0]) ? opts.existingVendors : [opts.existingVendors ?? []]
  ) as unknown[][];
  let call = 0;
  const getSuppliers = jest.fn().mockImplementation(async () => {
    const suppliers = pages[Math.min(call++, pages.length - 1)];
    return { suppliers, totalPages: 1 };
  });
  const createSupplier =
    opts.createSupplier ??
    jest.fn().mockResolvedValue({
      supplier: { id: 'main-sup-9', bookId: '58', syncStatus: 'synced' },
      syncedToBookkeeping: true,
      syncBatchId: 'b1',
      message: 'ok',
    });
  const syncSuppliersFromBookkeeping = jest.fn().mockResolvedValue(undefined);
  const mainApiPull = { getSuppliers, createSupplier, syncSuppliersFromBookkeeping };

  const service = new DashboardSuppliersApplicationService(
    supplierRepo as any,
    undefined as any,
    undefined as any,
    mainApiConnections as any,
    mainApiPull as any,
  );
  return { service, supplierRepo, getSuppliers, createSupplier, syncSuppliersFromBookkeeping };
}

describe('DashboardSuppliersApplicationService.ensureInErp', () => {
  it('returns linked without calling the ERP when the supplier already has a bookId', async () => {
    const { service, createSupplier, getSuppliers } = makeService({
      supplier: makeSupplier({ bookId: '17' }),
    });

    const result = await service.ensureInErp(TENANT_ID, 'supplier-1');

    expect(result).toEqual(expect.objectContaining({ status: 'linked', created: false }));
    expect(getSuppliers).not.toHaveBeenCalled();
    expect(createSupplier).not.toHaveBeenCalled();
  });

  it('adopts an existing ERP vendor with the same PIN even when its name differs', async () => {
    const supplier = makeSupplier();
    const { service, createSupplier } = makeService({
      supplier,
      existingVendors: [{ id: 'main-sup-3', bookId: '21', supplierName: 'Sync2Books Reconciler Ltd', taxNumber: ' p052581715v ' }],
    });

    const result = await service.ensureInErp(TENANT_ID, 'supplier-1');

    expect(createSupplier).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ status: 'linked', created: false }));
    expect(supplier.bookId).toBe('21');
    expect(supplier.externalId).toBe('main-sup-3');
    expect(supplier.sourceSystem).toBe('QUICKBOOKS');
  });

  it('creates the vendor in the ERP and stores its ids when nothing matches', async () => {
    const supplier = makeSupplier();
    const { service, createSupplier } = makeService({ supplier });

    const result = await service.ensureInErp(TENANT_ID, 'supplier-1');

    expect(createSupplier).toHaveBeenCalledWith('key-1', 'conn-1', {
      supplierName: 'SYNC TO BOOKS RECONCILER LIMITED',
      taxNumber: 'P052581715V',
      emailAddress: undefined,
      phone: undefined,
      status: 'Active',
    });
    expect(result).toEqual(expect.objectContaining({ status: 'linked', created: true }));
    expect(supplier.bookId).toBe('58');
    expect(supplier.externalId).toBe('main-sup-9');
  });

  it('refreshes from the ERP and adopts after a duplicate-name rejection', async () => {
    const supplier = makeSupplier();
    const createSupplier = jest.fn().mockResolvedValue({
      supplier: { id: 'main-sup-9', syncStatus: 'pending' },
      syncedToBookkeeping: false,
      syncError: 'Duplicate Name Exists Error',
      syncBatchId: 'b1',
      message: 'failed',
    });
    const { service, syncSuppliersFromBookkeeping } = makeService({
      supplier,
      createSupplier,
      existingVendors: [[], [{ id: 'main-sup-4', bookId: '33', supplierName: 'Sync To Books Reconciler Limited' }]],
    });

    const result = await service.ensureInErp(TENANT_ID, 'supplier-1');

    expect(syncSuppliersFromBookkeeping).toHaveBeenCalledWith('key-1', 'conn-1');
    expect(result).toEqual(expect.objectContaining({ status: 'linked', created: false }));
    expect(supplier.bookId).toBe('33');
  });

  it('returns the ERP error when the vendor could not be created', async () => {
    const createSupplier = jest.fn().mockResolvedValue({
      supplier: { id: 'main-sup-9', syncStatus: 'pending' },
      syncedToBookkeeping: false,
      syncError: 'Invalid VAT number',
      syncBatchId: 'b1',
      message: 'failed',
    });
    const { service, supplierRepo } = makeService({ supplier: makeSupplier(), createSupplier });

    const result = await service.ensureInErp(TENANT_ID, 'supplier-1');

    expect(result).toEqual(expect.objectContaining({ status: 'failed', error: 'Invalid VAT number' }));
    expect(supplierRepo.save).not.toHaveBeenCalled();
  });

  it('skips when no ERP is connected', async () => {
    const { service, createSupplier } = makeService({
      supplier: makeSupplier(),
      integrations: { quickbooks: { connectionId: null } },
    });

    const result = await service.ensureInErp(TENANT_ID, 'supplier-1');

    expect(result.status).toBe('skipped');
    expect(createSupplier).not.toHaveBeenCalled();
  });
});
