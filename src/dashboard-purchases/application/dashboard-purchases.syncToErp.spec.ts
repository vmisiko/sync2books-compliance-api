import { BadRequestException } from '@nestjs/common';
import { DashboardPurchasesApplicationService } from './dashboard-purchases.application.service';
import type { PurchaseInvoiceOrmEntity } from '../infrastructure/persistence/purchase-invoice.orm-entity';
import type { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import type { DashboardSuppliersApplicationService } from '../../dashboard-suppliers/application/dashboard-suppliers.application.service';
import type { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import type { MainApiConnection } from '../../integration/main-api-pull/domain/entities/main-api-connection.entity';
import type { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import type { PurchaseBillMappingService } from './purchase-bill-mapping.service';

const MERCHANT_ID = 'merchant-1';
const TENANT_ID = 'tenant-1';

function makePurchaseRow(
  overrides: Partial<PurchaseInvoiceOrmEntity> = {},
): PurchaseInvoiceOrmEntity {
  return {
    id: 'purchase-1',
    merchantId: MERCHANT_ID,
    branchId: null,
    branchName: null,
    kraBhfId: null,
    spplrTin: '123',
    spplrInvcNo: '1',
    supplierName: 'ABC Supplies',
    supplierPin: '123',
    supplierId: 'supplier-1',
    receiptNo: 'RCPT-1',
    invoiceDate: '2026-08-20',
    subtotal: 100,
    vat: 16,
    total: 116,
    confirmationStatus: 'confirmed',
    erpSyncStatus: 'not_synced',
    lineItems: [
      {
        id: '1',
        description: 'Widget',
        hsCode: '',
        qty: 1,
        unitPrice: 100,
        taxRate: 16,
        taxAmount: 16,
        total: 116,
      },
    ],
    rawKraResponse: null,
    kraConfirmInvcNo: null,
    kraConfirmResultCd: null,
    kraConfirmError: null,
    kraConfirmedAt: null,
    paymentTypeCode: null,
    erpBillId: null,
    erpSyncBatchId: null,
    erpSyncError: null,
    erpSyncedAt: null,
    pulledAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PurchaseInvoiceOrmEntity;
}

function makeConnection(
  overrides: Partial<MainApiConnection['integrations']> = {
    quickbooks: { connectionId: 'conn-1', status: 'connected', reason: null, updatedAt: null },
  },
): MainApiConnection {
  return {
    id: 'main-api-conn-1',
    complianceTenantId: TENANT_ID,
    mainApiApplicationId: 'app-1',
    mainApiApiKey: 'key-1',
    mainApiCompanyId: 'company-1',
    integrations: overrides,
    webhookEndpointId: null,
    webhookSecret: null,
    lastWebhookEventId: null,
    autoUploadReceiptToSource: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const MAPPED = {
  integrationKey: 'quickbooks' as const,
  connectionId: 'conn-1',
  mainApiApiKey: 'key-1',
  expenseAccount: { erpId: '80', erpName: 'Cost of Goods Sold' },
  taxes: {
    B: { erpId: '2', erpName: '16.0% S' },
    A: { erpId: '12', erpName: 'Exempt' },
  },
};

type Setup = {
  rows: PurchaseInvoiceOrmEntity[];
  save: jest.Mock;
  ensureInErp: jest.Mock;
  resolveForSync: jest.Mock;
  resolveAccountOverride: jest.Mock;
  createBill: jest.Mock;
};

function linked(bookId = 'qb-vendor-1') {
  return {
    status: 'linked',
    created: false,
    supplier: { id: 'supplier-1', bookId, name: 'ABC Supplies' },
  };
}

function makeService(setup: Partial<Setup> & { rows: PurchaseInvoiceOrmEntity[] }) {
  const save = setup.save ?? jest.fn().mockImplementation(async (row) => row);
  const repo = {
    find: jest.fn().mockResolvedValue(setup.rows),
    save,
  };
  const organization = {
    getTenantById: async () =>
      ({ id: TENANT_ID, sync2booksCompanyId: MERCHANT_ID }) as Awaited<
        ReturnType<ComplianceOrganizationApplicationService['getTenantById']>
      >,
  };
  const ensureInErp = setup.ensureInErp ?? jest.fn().mockResolvedValue(linked());
  const suppliers = { ensureInErp };
  const mainApiConnections = {
    getForTenant: jest.fn().mockResolvedValue(makeConnection()),
    resolveMerchantId: jest.fn().mockResolvedValue(MERCHANT_ID),
  };
  const createBill =
    setup.createBill ??
    jest.fn().mockResolvedValue({
      bill: { id: 'main-api-bill-1', syncStatus: 'synced' },
      message: 'ok',
      syncBatchId: 'sync-batch-1',
      syncedToBookkeeping: true,
    });
  const mainApiPull = { createBill };
  const resolveForSync = setup.resolveForSync ?? jest.fn().mockResolvedValue(MAPPED);
  const resolveAccountOverride =
    setup.resolveAccountOverride ??
    jest.fn().mockResolvedValue({ erpId: '99', erpName: 'Office Supplies' });
  const billMapping = { resolveForSync, resolveAccountOverride };

  const service = new DashboardPurchasesApplicationService(
    repo as any,
    undefined as any,
    undefined as any,
    organization as unknown as ComplianceOrganizationApplicationService,
    undefined as any,
    suppliers as unknown as DashboardSuppliersApplicationService,
    undefined as any,
    mainApiConnections as unknown as MainApiConnectionApplicationService,
    mainApiPull as unknown as MainApiPullClient,
    billMapping as unknown as PurchaseBillMappingService,
  );

  return { service, resolveAccountOverride, repo, save, ensureInErp, createBill };
}

describe('DashboardPurchasesApplicationService.syncToErp', () => {
  it('pushes a confirmed, supplier-linked purchase as a Bill and marks it synced', async () => {
    const row = makePurchaseRow();
    const { service, createBill } = makeService({ rows: [row] });

    const result = await service.syncToErp(TENANT_ID, [row.id]);

    expect(createBill).toHaveBeenCalledWith(
      'key-1',
      'conn-1',
      expect.objectContaining({
        supplierRef: { id: 'qb-vendor-1', supplierName: 'ABC Supplies' },
        currency: 'KES',
        subTotal: 100,
        taxAmount: 16,
        totalAmount: 116,
        status: 'Open',
        lineItems: [
          expect.objectContaining({
            unitAmount: 100,
            quantity: 1,
            subTotal: 100,
            accountRef: { id: '80', name: 'Cost of Goods Sold' },
            taxRateRef: { id: '2', name: '16.0% S' },
          }),
        ],
      }),
    );
    expect(row.erpSyncStatus).toBe('synced');
    expect(row.erpBillId).toBe('main-api-bill-1');
    expect(row.erpSyncBatchId).toBe('sync-batch-1');
    expect(row.erpSyncError).toBeNull();
    expect(row.erpSyncedAt).toBeInstanceOf(Date);
    expect(result.errors).toHaveLength(0);
  });

  it('fails every row with a clear message when no accounting system is connected', async () => {
    const row = makePurchaseRow();
    const resolveForSync = jest.fn().mockResolvedValue(null);
    const { service, createBill } = makeService({ rows: [row], resolveForSync });

    const result = await service.syncToErp(TENANT_ID, [row.id]);

    expect(createBill).not.toHaveBeenCalled();
    expect(row.erpSyncStatus).toBe('sync_failed');
    expect(row.erpSyncError).toMatch(/no connected accounting system/i);
    expect(result.errors).toHaveLength(1);
  });

  it('refuses to sync a purchase that has not been confirmed with KRA yet', async () => {
    const row = makePurchaseRow({ confirmationStatus: 'pending_review' });
    const { service, createBill } = makeService({ rows: [row] });

    const result = await service.syncToErp(TENANT_ID, [row.id]);

    expect(createBill).not.toHaveBeenCalled();
    expect(row.erpSyncStatus).toBe('sync_failed');
    expect(row.erpSyncError).toMatch(/must be confirmed/i);
    expect(result.errors).toHaveLength(1);
  });

  it('refuses to sync a purchase with no linked supplier', async () => {
    const row = makePurchaseRow({ supplierId: null });
    const { service, createBill } = makeService({ rows: [row] });

    await service.syncToErp(TENANT_ID, [row.id]);

    expect(createBill).not.toHaveBeenCalled();
    expect(row.erpSyncStatus).toBe('sync_failed');
    expect(row.erpSyncError).toMatch(/link this purchase to a supplier/i);
  });

  it('creates the supplier in the ERP first when it has no bookId yet, then pushes the bill against it', async () => {
    const row = makePurchaseRow();
    const ensureInErp = jest.fn().mockResolvedValue({ ...linked('qb-new-58'), created: true });
    const { service, createBill } = makeService({ rows: [row], ensureInErp });

    await service.syncToErp(TENANT_ID, [row.id]);

    expect(ensureInErp).toHaveBeenCalledWith(TENANT_ID, 'supplier-1');
    expect(createBill).toHaveBeenCalledWith(
      'key-1',
      'conn-1',
      expect.objectContaining({ supplierRef: { id: 'qb-new-58', supplierName: 'ABC Supplies' } }),
    );
    expect(row.erpSyncStatus).toBe('synced');
  });

  it('reports the ERP\'s own error when the supplier cannot be created there', async () => {
    const row = makePurchaseRow();
    const ensureInErp = jest.fn().mockResolvedValue({
      status: 'failed',
      supplier: { id: 'supplier-1', bookId: null, name: 'ABC Supplies' },
      error: 'Invalid email address',
    });
    const { service, createBill } = makeService({ rows: [row], ensureInErp });

    await service.syncToErp(TENANT_ID, [row.id]);

    expect(createBill).not.toHaveBeenCalled();
    expect(row.erpSyncStatus).toBe('sync_failed');
    expect(row.erpSyncError).toBe(
      'Could not create supplier "ABC Supplies" in your accounting system: Invalid email address',
    );
  });

  it('pushes a shared supplier to the ERP only once per run', async () => {
    const rows = [makePurchaseRow(), makePurchaseRow({ id: 'purchase-2', receiptNo: 'RCPT-2' })];
    const { service, ensureInErp, createBill } = makeService({ rows });

    await service.syncToErp(TENANT_ID, rows.map((r) => r.id));

    expect(ensureInErp).toHaveBeenCalledTimes(1);
    expect(createBill).toHaveBeenCalledTimes(2);
  });

  it('refuses to sync until a bill account is mapped', async () => {
    const row = makePurchaseRow();
    const resolveForSync = jest.fn().mockResolvedValue({ ...MAPPED, expenseAccount: null });
    const { service, createBill } = makeService({ rows: [row], resolveForSync });

    await service.syncToErp(TENANT_ID, [row.id]);

    expect(createBill).not.toHaveBeenCalled();
    expect(row.erpSyncError).toMatch(/Mapping Center → Purchase Bills/);
  });

  describe('choosing the account for this sync', () => {
    it('posts the bill to the chosen account instead of the saved default', async () => {
      const row = makePurchaseRow();
      const { service, createBill, resolveAccountOverride } = makeService({ rows: [row] });

      await service.syncToErp(TENANT_ID, [row.id], { expenseAccountId: '99' });

      expect(resolveAccountOverride).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'conn-1' }), '99');
      const bill = createBill.mock.calls[0][2];
      expect(bill.lineItems[0].accountRef).toEqual({ id: '99', name: 'Office Supplies' });
      expect(row.erpSyncStatus).toBe('synced');
    });

    it('works when no default account is saved, which is what a user stuck on that error needs', async () => {
      const row = makePurchaseRow();
      const resolveForSync = jest.fn().mockResolvedValue({ ...MAPPED, expenseAccount: null });
      const { service, createBill } = makeService({ rows: [row], resolveForSync });

      await service.syncToErp(TENANT_ID, [row.id], { expenseAccountId: '99' });

      expect(createBill).toHaveBeenCalledTimes(1);
      expect(row.erpSyncStatus).toBe('synced');
    });

    it('uses the saved default when no account is chosen, and never looks one up', async () => {
      const row = makePurchaseRow();
      const { service, createBill, resolveAccountOverride } = makeService({ rows: [row] });

      await service.syncToErp(TENANT_ID, [row.id]);

      expect(resolveAccountOverride).not.toHaveBeenCalled();
      expect(createBill.mock.calls[0][2].lineItems[0].accountRef).toEqual({
        id: '80',
        name: 'Cost of Goods Sold',
      });
    });

    it('applies the chosen account to every purchase in the batch', async () => {
      const a = makePurchaseRow({ id: 'p-a' });
      const b = makePurchaseRow({ id: 'p-b', spplrInvcNo: '2' });
      const { service, createBill } = makeService({ rows: [a, b] });

      await service.syncToErp(TENANT_ID, [a.id, b.id], { expenseAccountId: '99' });

      expect(createBill).toHaveBeenCalledTimes(2);
      for (const call of createBill.mock.calls) {
        expect(call[2].lineItems[0].accountRef.id).toBe('99');
      }
    });

    it('refuses an account the ERP does not have, before touching any purchase', async () => {
      const row = makePurchaseRow();
      const resolveAccountOverride = jest
        .fn()
        .mockRejectedValue(new BadRequestException('Account 404 was not found in your accounting system.'));
      const { service, createBill } = makeService({ rows: [row], resolveAccountOverride });

      await expect(service.syncToErp(TENANT_ID, [row.id], { expenseAccountId: '404' })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(createBill).not.toHaveBeenCalled();
      expect(row.erpSyncStatus).toBe('not_synced');
      expect(row.erpSyncError).toBeNull();
    });

    it('ignores the chosen account when no accounting system is connected, with the usual message', async () => {
      const row = makePurchaseRow();
      const resolveForSync = jest.fn().mockResolvedValue(null);
      const { service, resolveAccountOverride } = makeService({ rows: [row], resolveForSync });

      await service.syncToErp(TENANT_ID, [row.id], { expenseAccountId: '99' });

      expect(resolveAccountOverride).not.toHaveBeenCalled();
      expect(row.erpSyncError).toMatch(/No connected accounting system/);
    });
  });

  it('names every KRA tax type on the bill that has no ERP tax mapped', async () => {
    const row = makePurchaseRow({
      lineItems: [
        { id: '1', description: 'Fuel', hsCode: '', qty: 1, unitPrice: 108, taxRate: 8, taxAmount: 8, total: 108 },
        { id: '2', description: 'Export', hsCode: '', qty: 1, unitPrice: 50, taxRate: 0, taxAmount: 0, total: 50 },
      ],
      rawKraResponse: {
        itemList: [
          { itemSeq: 1, taxTyCd: 'E' },
          { itemSeq: 2, taxTyCd: 'C' },
        ],
      },
    });
    const { service, createBill } = makeService({ rows: [row] });

    await service.syncToErp(TENANT_ID, [row.id]);

    expect(createBill).not.toHaveBeenCalled();
    expect(row.erpSyncError).toMatch(/^Map KRA tax types C, E to a tax/);
  });

  it('sends net (VAT-exclusive) amounts, collapsing a line whose net does not split evenly per unit', async () => {
    const row = makePurchaseRow({
      lineItems: [
        // 3 units, 100.00 net: 33.33 × 3 = 99.99, so it must post as one line of 100.00.
        { id: '1', description: 'Paper', hsCode: '', qty: 3, unitPrice: 38.67, taxRate: 16, taxAmount: 16, total: 116 },
        { id: '2', description: 'Pens', hsCode: '', qty: 2, unitPrice: 50, taxRate: 0, taxAmount: 0, total: 100 },
      ],
      rawKraResponse: {
        itemList: [
          { itemSeq: 1, taxTyCd: 'B' },
          { itemSeq: 2, taxTyCd: 'A' },
        ],
      },
    });
    const { service, createBill } = makeService({ rows: [row] });

    await service.syncToErp(TENANT_ID, [row.id]);

    const body = createBill.mock.calls[0][2];
    expect(body.lineItems[0]).toEqual(
      expect.objectContaining({
        description: 'Paper (qty 3)',
        unitAmount: 100,
        quantity: 1,
        taxRateRef: { id: '2', name: '16.0% S' },
      }),
    );
    expect(body.lineItems[1]).toEqual(
      expect.objectContaining({
        unitAmount: 50,
        quantity: 2,
        taxRateRef: { id: '12', name: 'Exempt' },
      }),
    );
    expect(body).toEqual(expect.objectContaining({ subTotal: 200, taxAmount: 16, totalAmount: 216 }));
  });

  it('skips a purchase that is already synced instead of re-pushing it', async () => {
    const row = makePurchaseRow({ erpSyncStatus: 'synced', erpBillId: 'already-there' });
    const { service, createBill } = makeService({ rows: [row] });

    const result = await service.syncToErp(TENANT_ID, [row.id]);

    expect(createBill).not.toHaveBeenCalled();
    expect(row.erpBillId).toBe('already-there');
    expect(result.errors).toHaveLength(0);
  });

  it('records the ERP error on the row and reports it, without throwing, when the push fails outright', async () => {
    const row = makePurchaseRow();
    const createBill = jest.fn().mockRejectedValue(new Error('Main API request failed (502)'));
    const { service } = makeService({ rows: [row], createBill });

    const result = await service.syncToErp(TENANT_ID, [row.id]);

    expect(row.erpSyncStatus).toBe('sync_failed');
    expect(row.erpSyncError).toBe('Main API request failed (502)');
    expect(result.errors).toEqual([
      { id: row.id, receiptNo: row.receiptNo, message: 'Main API request failed (502)' },
    ]);
  });

  it('marks sync_failed (not synced) when the bill is created in main API but the ERP write itself fails', async () => {
    const row = makePurchaseRow();
    const createBill = jest.fn().mockResolvedValue({
      bill: {
        id: 'main-api-bill-1',
        syncStatus: 'failed',
        syncError: 'QuickBooks rejected the bill: invalid VendorRef',
      },
      message: 'Bill created but sync to bookkeeping failed',
      syncBatchId: 'sync-batch-1',
      syncedToBookkeeping: false,
    });
    const { service } = makeService({ rows: [row], createBill });

    const result = await service.syncToErp(TENANT_ID, [row.id]);

    expect(row.erpSyncStatus).toBe('sync_failed');
    expect(row.erpBillId).toBe('main-api-bill-1');
    expect(row.erpSyncBatchId).toBe('sync-batch-1');
    expect(row.erpSyncError).toBe('QuickBooks rejected the bill: invalid VendorRef');
    expect(result.errors).toEqual([
      {
        id: row.id,
        receiptNo: row.receiptNo,
        message: 'QuickBooks rejected the bill: invalid VendorRef',
      },
    ]);
  });
});
