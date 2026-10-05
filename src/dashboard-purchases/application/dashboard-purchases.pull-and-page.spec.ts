import { NotFoundException } from '@nestjs/common';
import type { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import type { PurchaseInvoiceOrmEntity } from '../infrastructure/persistence/purchase-invoice.orm-entity';
import { DashboardPurchasesApplicationService } from './dashboard-purchases.application.service';

const TENANT_ID = 'tenant-1';
const MERCHANT_ID = 'merchant-1';

const branches = [
  { id: 'b-hq', sync2booksBranchId: null, kraBhfId: '00', displayName: 'HQ' },
  { id: 'b-2', sync2booksBranchId: 'sb-2', kraBhfId: '01', displayName: 'Westlands' },
];

function row(
  id: string,
  invoiceDate: string,
  overrides: Partial<PurchaseInvoiceOrmEntity> = {},
): PurchaseInvoiceOrmEntity {
  return {
    id,
    merchantId: MERCHANT_ID,
    invoiceDate,
    confirmationStatus: 'pending_review',
    lineItems: [],
    pulledAt: new Date('2026-10-01T00:00:00Z'),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  } as PurchaseInvoiceOrmEntity;
}

function makeService(opts: {
  rows?: PurchaseInvoiceOrmEntity[];
  purchaseTransactionInfo?: jest.Mock;
}) {
  const repo = { find: jest.fn().mockResolvedValue(opts.rows ?? []) };
  const organization = {
    getTenantById: async () => ({ id: TENANT_ID, sync2booksCompanyId: MERCHANT_ID }),
    listBranches: async () => branches,
  };
  const oscuOperations = {
    purchaseTransactionInfo:
      opts.purchaseTransactionInfo ??
      jest.fn().mockResolvedValue({ rawResponse: { data: { saleList: [] } } }),
  };
  const service = new DashboardPurchasesApplicationService(
    repo as any,
    undefined as any,
    undefined as any,
    organization as unknown as ComplianceOrganizationApplicationService,
    oscuOperations as any,
    undefined as any,
    undefined as any,
    { resolveMerchantId: async () => MERCHANT_ID } as any,
    undefined as any,
    undefined as any,
    undefined as any,
  );
  const upsert = jest
    .spyOn(service as any, 'upsertFromKraRecord')
    .mockResolvedValue(undefined);
  return { service, repo, upsert, oscuOperations };
}

const kraList = (n: number) => ({
  rawResponse: { data: { saleList: Array.from({ length: n }, (_, i) => ({ spplrInvcNo: i })) } },
});

describe('DashboardPurchasesApplicationService.pullBranches', () => {
  it('reports how many invoices each branch returned and stores every one', async () => {
    const info = jest
      .fn()
      .mockResolvedValueOnce(kraList(3))
      .mockResolvedValueOnce(kraList(0));
    const { service, upsert } = makeService({ purchaseTransactionInfo: info });

    const report = await service.pullBranches(TENANT_ID);

    expect(report).toEqual([
      { branchId: 'b-hq', kraBhfId: '00', displayName: 'HQ', status: 'ok', fetched: 3, error: null },
      { branchId: 'b-2', kraBhfId: '01', displayName: 'Westlands', status: 'ok', fetched: 0, error: null },
    ]);
    expect(upsert).toHaveBeenCalledTimes(3);
    // A branch with no main-API link is addressed by its own id.
    expect(info.mock.calls.map((c) => c[1])).toEqual(['b-hq', 'sb-2']);
  });

  it('keeps going after one branch fails, and says which one failed and why', async () => {
    const info = jest
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 400 calling OSCU: device not initialised'))
      .mockResolvedValueOnce(kraList(2));
    const { service, upsert } = makeService({ purchaseTransactionInfo: info });

    const report = await service.pullBranches(TENANT_ID);

    expect(report[0]).toMatchObject({
      branchId: 'b-hq',
      status: 'failed',
      fetched: 0,
      error: 'HTTP 400 calling OSCU: device not initialised',
    });
    expect(report[1]).toMatchObject({ branchId: 'b-2', status: 'ok', fetched: 2 });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('caps a very long error message', async () => {
    const info = jest.fn().mockRejectedValue(new Error('x'.repeat(2000)));
    const { service } = makeService({ purchaseTransactionInfo: info });
    const [first] = await service.pullBranches(TENANT_ID, { branchId: 'b-hq' });
    expect(first.error).toHaveLength(300);
  });

  it('pulls only the branch asked for', async () => {
    const { service, oscuOperations } = makeService({});
    const report = await service.pullBranches(TENANT_ID, { branchId: 'b-2' });
    expect(report.map((r) => r.branchId)).toEqual(['b-2']);
    expect(oscuOperations.purchaseTransactionInfo).toHaveBeenCalledTimes(1);
  });

  it('pull() still returns the stored list when a branch failed, as the dashboard expects', async () => {
    const info = jest.fn().mockRejectedValue(new Error('KRA down'));
    const { service } = makeService({
      rows: [row('p1', '2026-09-01')],
      purchaseTransactionInfo: info,
    });
    const result = await service.pull(TENANT_ID);
    expect(result.total).toBe(1);
  });
});

describe('DashboardPurchasesApplicationService.listPage', () => {
  const rows = [
    row('p5', '2026-09-30'),
    row('p4', '2026-09-20'),
    row('p3', '2026-09-10'),
    row('p2', '2026-09-01'),
    row('p1', '2026-08-15'),
  ];

  it('pages newest-first with a cursor and ends with a null cursor', async () => {
    const { service } = makeService({ rows });

    const first = await service.listPage(TENANT_ID, { pageSize: 2 });
    expect(first.data.map((d) => d.id)).toEqual(['p5', 'p4']);
    expect(first.next).toBe('p4');

    const second = await service.listPage(TENANT_ID, { pageSize: 2, cursor: first.next! });
    expect(second.data.map((d) => d.id)).toEqual(['p3', 'p2']);
    expect(second.next).toBe('p2');

    const last = await service.listPage(TENANT_ID, { pageSize: 2, cursor: second.next! });
    expect(last.data.map((d) => d.id)).toEqual(['p1']);
    expect(last.next).toBeNull();
  });

  it('has no next page when the results exactly fill the page', async () => {
    const { service } = makeService({ rows });
    const page = await service.listPage(TENANT_ID, { pageSize: 5 });
    expect(page.data).toHaveLength(5);
    expect(page.next).toBeNull();
  });

  it('404s a cursor that is not one of this business’s own invoices', async () => {
    const { service } = makeService({ rows });
    await expect(
      service.listPage(TENANT_ID, { pageSize: 2, cursor: 'someone-elses' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('filters by status in the query and by invoice date inclusively', async () => {
    const { service, repo } = makeService({ rows });

    const page = await service.listPage(TENANT_ID, {
      pageSize: 10,
      status: 'confirmed',
      startDate: '2026-09-01',
      endDate: '2026-09-20',
    });

    expect(repo.find.mock.calls[0][0].where).toEqual({
      merchantId: MERCHANT_ID,
      confirmationStatus: 'confirmed',
    });
    expect(page.data.map((d) => d.id)).toEqual(['p4', 'p3', 'p2']);
  });

  it('compares the date part of a full ISO timestamp', async () => {
    const { service } = makeService({
      rows: [row('t1', '2026-09-20T23:30:00.000Z')],
    });
    const page = await service.listPage(TENANT_ID, { pageSize: 10, endDate: '2026-09-20' });
    expect(page.data.map((d) => d.id)).toEqual(['t1']);
  });
});
