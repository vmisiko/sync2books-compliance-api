import { BadRequestException } from '@nestjs/common';
import { DashboardPurchasesApplicationService } from './dashboard-purchases.application.service';
import type { PurchaseInvoiceOrmEntity } from '../infrastructure/persistence/purchase-invoice.orm-entity';

const MERCHANT_ID = 'merchant-1';
const TENANT_ID = 'tenant-1';

function makeRow(overrides: Partial<PurchaseInvoiceOrmEntity> = {}): PurchaseInvoiceOrmEntity {
  return {
    id: 'purchase-1',
    merchantId: MERCHANT_ID,
    supplierName: 'ABC Supplies',
    supplierPin: '123',
    supplierId: 'supplier-1',
    receiptNo: 'RCPT-1',
    invoiceDate: '2026-08-20',
    confirmationStatus: 'confirmed',
    erpSyncStatus: 'synced',
    lineItems: [
      { id: '1', description: 'Bread', hsCode: '', qty: 2, unitPrice: 50, taxRate: 0, taxAmount: 0, total: 100 },
    ],
    rawKraResponse: null,
    erpBillId: 'main-bill-1',
    erpBillBookId: 'odoo-9',
    erpBillNumber: 'BILL/1',
    erpPosting: {
      accountId: '80',
      accountName: 'COGS',
      lines: [{ lineId: '1', description: 'Bread', taxId: '7', taxName: '2% WH', taxTyCd: 'A' }],
    },
    erpSyncBatchId: 'b1',
    erpSyncError: null,
    erpSyncedAt: new Date('2026-09-01'),
    subtotal: 100,
    vat: 0,
    total: 100,
    pulledAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as PurchaseInvoiceOrmEntity;
}

const MAPPED = {
  integrationKey: 'odoo' as const,
  connectionId: 'conn-1',
  mainApiApiKey: 'key-1',
  expenseAccount: { erpId: '80', erpName: 'COGS' },
  taxes: { A: { erpId: '8', erpName: '0% Zero' } },
};

function makeService(opts: {
  rows: PurchaseInvoiceOrmEntity[];
  resyncBill?: jest.Mock;
  conflicts?: string[];
  noDefaultAccount?: boolean;
  resolveAccountOverride?: jest.Mock;
}) {
  const find = jest.fn().mockImplementation(async ({ where }) =>
    opts.rows.filter((r) => r.merchantId === where.merchantId),
  );
  const save = jest.fn().mockImplementation(async (r) => r);
  const resyncBill = opts.resyncBill ?? jest.fn().mockResolvedValue({ syncedToBookkeeping: true });
  const ensureInErp = jest.fn().mockResolvedValue({
    status: 'linked',
    supplier: { id: 'supplier-1', bookId: 'odoo-vendor-1', name: 'ABC Supplies' },
  });
  const service = new DashboardPurchasesApplicationService(
    { find, save } as any,
    undefined as any,
    undefined as any,
    { getTenantById: async () => ({ id: TENANT_ID, sync2booksCompanyId: MERCHANT_ID }) } as any,
    undefined as any,
    { ensureInErp } as any,
    undefined as any,
    { resolveMerchantId: jest.fn().mockResolvedValue(MERCHANT_ID) } as any,
    { resyncBill } as any,
    {
      resolveForSync: jest
        .fn()
        .mockResolvedValue(opts.noDefaultAccount ? { ...MAPPED, expenseAccount: null } : MAPPED),
      findLineTaxConflicts: jest.fn().mockResolvedValue(opts.conflicts ?? []),
      resolveAccountOverride:
        opts.resolveAccountOverride ??
        jest.fn().mockImplementation(async (_m, id: string) => ({ erpId: id, erpName: `Account ${id}` })),
    } as any,
  );
  return { service, find, save, resyncBill };
}

describe('DashboardPurchasesApplicationService.resyncToErp', () => {
  it('rebuilds the lines from the current mapping, calls main-API resync and updates erpPosting', async () => {
    const row = makeRow();
    const { service, resyncBill, save } = makeService({ rows: [row] });

    const result = await service.resyncToErp(TENANT_ID, [row.id]);

    expect(resyncBill).toHaveBeenCalledWith(
      'key-1',
      'conn-1',
      'main-bill-1',
      expect.objectContaining({
        supplierRef: { id: 'odoo-vendor-1', supplierName: 'ABC Supplies' },
        status: 'Open',
        lineItems: [
          expect.objectContaining({
            isDirectCost: true,
            quantity: 2,
            unitAmount: 50,
            taxRateRef: { id: '8', name: '0% Zero' },
            accountRef: { id: '80', name: 'COGS' },
          }),
        ],
      }),
    );
    expect(row.erpPosting?.lines[0]).toMatchObject({ taxId: '8', taxName: '0% Zero', taxTyCd: 'A' });
    expect(row.erpSyncStatus).toBe('synced');
    expect(row.erpSyncedAt!.getTime()).toBeGreaterThan(new Date('2026-09-01').getTime());
    expect(save).toHaveBeenCalledWith(row);
    expect(result.results).toEqual([expect.objectContaining({ id: row.id, status: 'resynced' })]);
    expect(result.errors).toHaveLength(0);
  });

  it('keeps the account the bill was posted to even when no default account is saved', async () => {
    const row = makeRow({
      erpPosting: { accountId: '55', accountName: 'Per-sync account', lines: [] },
    });
    const { service, resyncBill } = makeService({ rows: [row], noDefaultAccount: true });

    await service.resyncToErp(TENANT_ID, [row.id]);

    expect(resyncBill).toHaveBeenCalledWith(
      'key-1',
      'conn-1',
      'main-bill-1',
      expect.objectContaining({
        lineItems: [expect.objectContaining({ accountRef: { id: '55', name: 'Per-sync account' } })],
      }),
    );
    expect(row.erpPosting?.accountId).toBe('55');
  });

  it('re-syncs a bill with no recorded account and no saved default when an account is chosen', async () => {
    // The state of a purchase synced before posting details were recorded, on a business that
    // only ever picked an account in the sync dialog.
    const row = makeRow({ erpPosting: null });
    const { service, resyncBill } = makeService({ rows: [row], noDefaultAccount: true });

    const result = await service.resyncToErp(TENANT_ID, [row.id], { expenseAccountId: '91' });

    expect(resyncBill).toHaveBeenCalledWith(
      'key-1',
      'conn-1',
      'main-bill-1',
      expect.objectContaining({
        lineItems: [expect.objectContaining({ accountRef: { id: '91', name: 'Account 91' } })],
      }),
    );
    expect(row.erpPosting?.accountId).toBe('91');
    expect(result.errors).toHaveLength(0);
  });

  it('lets a chosen account win over the account the bill was posted to', async () => {
    const row = makeRow({ erpPosting: { accountId: '55', accountName: 'Old', lines: [] } });
    const { service, resyncBill } = makeService({ rows: [row] });

    await service.resyncToErp(TENANT_ID, [row.id], { expenseAccountId: '91' });

    expect(resyncBill).toHaveBeenCalledWith(
      'key-1',
      'conn-1',
      'main-bill-1',
      expect.objectContaining({
        lineItems: [expect.objectContaining({ accountRef: { id: '91', name: 'Account 91' } })],
      }),
    );
  });

  it('asks for an account when none is recorded, saved or chosen', async () => {
    const row = makeRow({ erpPosting: null });
    const { service, resyncBill } = makeService({ rows: [row], noDefaultAccount: true });

    const result = await service.resyncToErp(TENANT_ID, [row.id]);

    expect(resyncBill).not.toHaveBeenCalled();
    expect(result.errors[0].message).toMatch(/Choose the account for this bill/);
  });

  it('rejects the whole request when the chosen account is not in the ERP, before any bill is touched', async () => {
    const row = makeRow();
    const resolveAccountOverride = jest
      .fn()
      .mockRejectedValue(new BadRequestException('Account 404 was not found in your accounting system.'));
    const { service, resyncBill } = makeService({ rows: [row], resolveAccountOverride });

    await expect(service.resyncToErp(TENANT_ID, [row.id], { expenseAccountId: '404' })).rejects.toThrow(
      /was not found/,
    );
    expect(resyncBill).not.toHaveBeenCalled();
  });

  it('reports the posted-bill refusal per row and leaves the row unchanged', async () => {
    const row = makeRow();
    const before = JSON.stringify(row);
    const resyncBill = jest
      .fn()
      .mockRejectedValue(
        new BadRequestException(
          'This bill has already been posted in your accounting system and can no longer be changed from here.',
        ),
      );
    const { service, save } = makeService({ rows: [row], resyncBill });

    const result = await service.resyncToErp(TENANT_ID, [row.id]);

    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(row)).toBe(before);
    expect(row.erpSyncStatus).toBe('synced');
    expect(result.results[0]).toMatchObject({ status: 'failed' });
    expect(result.errors[0].message).toMatch(/already been posted/);
  });

  it('refuses rows that are not synced or have no erpBillId, without calling main API', async () => {
    const a = makeRow({ id: 'a', erpSyncStatus: 'not_synced' as any });
    const b = makeRow({ id: 'b', erpBillId: null });
    const { service, resyncBill } = makeService({ rows: [a, b] });

    const result = await service.resyncToErp(TENANT_ID, ['a', 'b']);

    expect(resyncBill).not.toHaveBeenCalled();
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].message).toMatch(/already synced/i);
  });

  it('refuses a rewrite that would put a zero-rated line on a withholding tax', async () => {
    const row = makeRow();
    const { service, resyncBill } = makeService({
      rows: [row],
      conflicts: ['Line "Bread" is zero-rated (KRA tax type A) but "2% WH" is a withholding tax (-2%).'],
    });

    const result = await service.resyncToErp(TENANT_ID, [row.id]);

    expect(resyncBill).not.toHaveBeenCalled();
    expect(result.errors[0].message).toMatch(/"Bread".*"2% WH"/);
  });

  it('is tenant-scoped: another merchant\'s purchase id is never touched', async () => {
    const foreign = makeRow({ id: 'foreign', merchantId: 'merchant-2' });
    const { service, find, resyncBill } = makeService({ rows: [foreign] });

    const result = await service.resyncToErp(TENANT_ID, ['foreign']);

    expect(find).toHaveBeenCalledWith({ where: { merchantId: MERCHANT_ID, id: expect.anything() } });
    expect(resyncBill).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(0);
  });

  it('rejects an empty selection', async () => {
    const { service } = makeService({ rows: [] });
    await expect(service.resyncToErp(TENANT_ID, [])).rejects.toThrow(BadRequestException);
  });
});
