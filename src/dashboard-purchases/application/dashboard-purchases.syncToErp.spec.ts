import { DashboardPurchasesApplicationService } from './dashboard-purchases.application.service';
import type { PurchaseInvoiceOrmEntity } from '../infrastructure/persistence/purchase-invoice.orm-entity';
import type { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import type { DashboardSuppliersApplicationService } from '../../dashboard-suppliers/application/dashboard-suppliers.application.service';
import type { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import type { MainApiConnection } from '../../integration/main-api-pull/domain/entities/main-api-connection.entity';
import type { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';

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

type Setup = {
  rows: PurchaseInvoiceOrmEntity[];
  save: jest.Mock;
  getById: jest.Mock;
  getForTenant: jest.Mock;
  createBill: jest.Mock;
};

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
  const getById =
    setup.getById ??
    jest.fn().mockResolvedValue({ id: 'supplier-1', bookId: 'qb-vendor-1', name: 'ABC Supplies' });
  const suppliers = { getById };
  const getForTenant = setup.getForTenant ?? jest.fn().mockResolvedValue(makeConnection());
  const mainApiConnections = { getForTenant };
  const createBill =
    setup.createBill ??
    jest.fn().mockResolvedValue({
      bill: { id: 'main-api-bill-1', syncStatus: 'synced' },
      message: 'ok',
      syncBatchId: 'sync-batch-1',
      syncedToBookkeeping: true,
    });
  const mainApiPull = { createBill };

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
  );

  return { service, repo, save, getById, getForTenant, createBill };
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
    const getForTenant = jest.fn().mockResolvedValue(makeConnection({}));
    const { service, createBill } = makeService({ rows: [row], getForTenant });

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

  it('refuses to sync when the matched supplier has no ERP-side bookId yet', async () => {
    const row = makePurchaseRow();
    const getById = jest
      .fn()
      .mockResolvedValue({ id: 'supplier-1', bookId: null, name: 'ABC Supplies' });
    const { service, createBill } = makeService({ rows: [row], getById });

    await service.syncToErp(TENANT_ID, [row.id]);

    expect(createBill).not.toHaveBeenCalled();
    expect(row.erpSyncStatus).toBe('sync_failed');
    expect(row.erpSyncError).toMatch(/not linked to a record in your accounting system/i);
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
