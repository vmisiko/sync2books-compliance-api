import { BadGatewayException, BadRequestException } from '@nestjs/common';
import type { PurchaseInvoiceDto } from '../../../dashboard-purchases/application/dashboard-purchases.application.service';
import type { V1ScopeService } from '../../application/v1-scope.service';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import { REQUIRED_SCOPES } from '../../infrastructure/decorators/require-scopes.decorator';
import { V1PurchasesController } from './v1-purchases.controller';

const TENANT = 'tenant-1';

const dto: PurchaseInvoiceDto = {
  id: 'p-1',
  receiptNo: 'SUP-INV-9',
  supplierName: 'ABC Supplies',
  supplierPin: 'P051234567A',
  branch: 'Headquarters',
  invoiceDate: '2026-09-20T08:00:00.000Z',
  subtotal: 100,
  vat: 16,
  total: 116,
  confirmationStatus: 'pending_review',
  // Everything below is internal to the dashboard and must not reach /v1.
  erpSyncStatus: 'synced',
  erpSyncError: 'secret ERP failure',
  supplierId: 'dashboard-supplier-1',
  lineItems: [
    {
      id: '1',
      description: 'Widget',
      hsCode: '',
      qty: 2,
      unitPrice: 50,
      taxRate: 16,
      taxAmount: 16,
      total: 116,
    },
  ],
  kraConfirmError: null,
  etimsMetadata: {
    fetchedAt: '2026-10-01T00:00:00.000Z',
    controlUnit: 'SDC-1',
    supplierMrcNo: 'MRC-1',
    receiptType: 'Purchase (Buyer Confirmation)',
    reference: 'P051234567A-9',
  },
} as PurchaseInvoiceDto;

function make(overrides: Record<string, jest.Mock> = {}) {
  const purchases = {
    pullBranches: jest.fn().mockResolvedValue([]),
    listPage: jest.fn().mockResolvedValue({ data: [dto], next: null }),
    getById: jest.fn().mockResolvedValue(dto),
    ...overrides,
  };
  const scope = {
    resolveBranch: jest.fn().mockResolvedValue({ id: 'branch-hq' }),
  };
  const controller = new V1PurchasesController(
    purchases as any,
    scope as unknown as V1ScopeService,
  );
  return { controller, purchases, scope };
}

const ok = (id: string, fetched: number) => ({
  branchId: id,
  kraBhfId: '00',
  displayName: id,
  status: 'ok' as const,
  fetched,
  error: null,
});
const failed = (id: string) => ({
  branchId: id,
  kraBhfId: '01',
  displayName: id,
  status: 'failed' as const,
  fetched: 0,
  error: 'KRA down',
});

describe('GET /v1/purchases', () => {
  it('returns an allow-listed view, none of the dashboard-internal fields', async () => {
    const { controller } = make();
    const res = await controller.list(TENANT);

    expect(res.data.purchases[0]).toEqual({
      id: 'p-1',
      status: 'pending_review',
      supplier: { name: 'ABC Supplies', pin: 'P051234567A' },
      supplierInvoiceNumber: 'SUP-INV-9',
      invoiceDate: '2026-09-20',
      branch: 'Headquarters',
      totals: { subtotal: 100, vat: 16, total: 116 },
      lines: [
        {
          description: 'Widget',
          hsCode: null,
          quantity: 2,
          unitPrice: 50,
          taxRate: 16,
          taxAmount: 16,
          total: 116,
        },
      ],
      confirmationError: null,
    });
    const text = JSON.stringify(res);
    for (const leaked of ['erpSync', 'secret ERP failure', 'dashboard-supplier-1', 'SDC-1', 'MRC-1', 'etimsMetadata']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('passes the business and filters through, and reports the next cursor', async () => {
    const { controller, purchases } = make({
      listPage: jest.fn().mockResolvedValue({ data: [dto], next: 'p-1' }),
    });
    const res = await controller.list(
      TENANT,
      'c-0',
      '5',
      'confirmed',
      '2026-09-01',
      '2026-09-30',
    );

    expect(purchases.listPage).toHaveBeenCalledWith(TENANT, {
      cursor: 'c-0',
      pageSize: 5,
      status: 'confirmed',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(res.pagination).toEqual({ nextCursor: 'p-1', pageSize: 5 });
  });

  it('rejects an unknown status, a bad date and an out-of-range page size', async () => {
    const { controller, purchases } = make();
    await expect(controller.list(TENANT, undefined, undefined, 'bogus')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(TENANT, undefined, undefined, undefined, '2026-02-31')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(TENANT, undefined, '500')).rejects.toBeInstanceOf(BadRequestException);
    expect(purchases.listPage).not.toHaveBeenCalled();
  });
});

describe('GET /v1/purchases/:id', () => {
  it('returns the same allow-listed view, for this business only', async () => {
    const { controller, purchases } = make();
    const res = await controller.get(TENANT, 'p-1');
    expect(purchases.getById).toHaveBeenCalledWith(TENANT, 'p-1');
    expect(res.data.purchase.supplier.pin).toBe('P051234567A');
    expect(JSON.stringify(res)).not.toContain('erpSync');
  });
});

describe('POST /v1/purchases/pull', () => {
  it('reports each branch and the total fetched', async () => {
    const { controller, purchases } = make({
      pullBranches: jest.fn().mockResolvedValue([ok('a', 3), ok('b', 2)]),
    });
    const res = await controller.pull(TENANT, undefined);
    expect(purchases.pullBranches).toHaveBeenCalledWith(TENANT, { branchId: undefined });
    expect(res.data.fetched).toBe(5);
    expect(res.data.branches).toHaveLength(2);
  });

  it('answers 200 with the failing branch named when only some branches failed', async () => {
    const { controller } = make({
      pullBranches: jest.fn().mockResolvedValue([ok('a', 3), failed('b')]),
    });
    const res = await controller.pull(TENANT, {});
    expect(res.data.branches.map((b) => b.status)).toEqual(['ok', 'failed']);
    expect(res.data.fetched).toBe(3);
  });

  it('is a 502 when KRA returned nothing for any branch, never an empty success', async () => {
    const { controller } = make({
      pullBranches: jest.fn().mockResolvedValue([failed('a'), failed('b')]),
    });
    const err = await controller.pull(TENANT, {}).catch((e) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect((err as BadGatewayException).getResponse()).toMatchObject({
      branches: [expect.objectContaining({ branchId: 'a' }), expect.objectContaining({ branchId: 'b' })],
    });
  });

  it('is a plain success when the business has no branches to pull', async () => {
    const { controller } = make({ pullBranches: jest.fn().mockResolvedValue([]) });
    const res = await controller.pull(TENANT, {});
    expect(res.data).toEqual({ fetched: 0, branches: [] });
  });

  it('resolves a named branch against this business before pulling it', async () => {
    const { controller, scope, purchases } = make({
      pullBranches: jest.fn().mockResolvedValue([ok('branch-hq', 1)]),
    });
    await controller.pull(TENANT, { branchId: 'hq' });
    expect(scope.resolveBranch).toHaveBeenCalledWith(TENANT, 'hq');
    expect(purchases.pullBranches).toHaveBeenCalledWith(TENANT, { branchId: 'branch-hq' });
  });

  it('never reaches KRA for another business’s branch', async () => {
    const { controller, purchases } = make();
    (controller as any).scope.resolveBranch = jest.fn().mockRejectedValue(new Error('not found'));
    await expect(controller.pull(TENANT, { branchId: 'theirs' })).rejects.toThrow('not found');
    expect(purchases.pullBranches).not.toHaveBeenCalled();
  });
});

describe('required scope', () => {
  it.each(['pull', 'list', 'get'] as const)('%s needs purchases:read', (handler) => {
    const scopes = Reflect.getMetadata(
      REQUIRED_SCOPES,
      V1PurchasesController.prototype[handler],
    );
    expect(scopes).toEqual([ApiKeyScope.PURCHASES_READ]);
  });
});
