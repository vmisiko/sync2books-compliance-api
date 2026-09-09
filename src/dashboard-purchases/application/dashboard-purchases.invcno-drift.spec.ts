import { DashboardPurchasesApplicationService } from './dashboard-purchases.application.service';
import type { PurchaseInvoiceOrmEntity } from '../infrastructure/persistence/purchase-invoice.orm-entity';

const MERCHANT_ID = 'merchant-1';
const TENANT_ID = 'tenant-1';
const BRANCH_ID = 'branch-1';
const SYNC_KEY = 'purchase_confirm_seq:P600004185A:SANDBOX';

/**
 * Purchases carry their own invcNo sequence for sendPurchaseTransactionInfo --
 * `purchase_confirm_seq:*`, entirely separate from sales' `invoice_seq:*` --
 * but it drifts for the same shared-PIN reason: another database submitting to
 * P600004185A consumes values this one never sees. KRA names the expected
 * value in the rejection, so it takes the same inline repair as sales rather
 * than the itemCd probe.
 */
const DRIFT_ERROR =
  'HTTP 400 calling OSCU: Invc No: 4 is invalid, use the expected value: 12';

function makeRow(
  overrides: Partial<PurchaseInvoiceOrmEntity> = {},
): PurchaseInvoiceOrmEntity {
  return {
    id: 'purchase-1',
    merchantId: MERCHANT_ID,
    branchId: BRANCH_ID,
    spplrTin: '123',
    spplrInvcNo: '1',
    supplierName: 'ABC Supplies',
    supplierPin: 'P012345678X',
    receiptNo: 'RCPT-1',
    invoiceDate: '2026-08-20',
    subtotal: 100,
    vat: 16,
    total: 116,
    confirmationStatus: 'pending_review',
    lineItems: [],
    rawKraResponse: { itemList: [{ itemNm: 'Widget', qty: 1, prc: 100 }] },
    kraConfirmInvcNo: null,
    kraConfirmResultCd: null,
    kraConfirmError: null,
    kraConfirmedAt: null,
    pulledAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PurchaseInvoiceOrmEntity;
}

function makeService(initialCounter: string, sendPurchaseTransaction: jest.Mock) {
  const row = makeRow();
  const store = new Map<string, string>([[SYNC_KEY, initialCounter]]);

  const repo = {
    find: () => Promise.resolve([row]),
    findOne: () => Promise.resolve(row),
    save: (r: PurchaseInvoiceOrmEntity) => Promise.resolve(r),
  };
  const syncStateRepo = {
    findOne: ({ where: { syncKey } }: { where: { syncKey: string } }) =>
      Promise.resolve(
        store.has(syncKey) ? { syncKey, lastReqDt: store.get(syncKey) } : null,
      ),
    upsert: ({
      syncKey,
      lastReqDt,
    }: {
      syncKey: string;
      lastReqDt: string;
    }) => {
      store.set(syncKey, lastReqDt);
      return Promise.resolve(undefined);
    },
  };
  const catalogRepo = {
    findByMerchantAndName: () =>
      Promise.resolve({
        id: 'item-1',
        name: 'Widget',
        registrationStatus: 'REGISTERED',
        etimsItemCode: 'KE2BAAV0000020',
        classificationCode: '1010151200',
        unitCode: 'AV',
        packagingUnitCode: 'BA',
        taxTyCd: 'B',
      }),
  };
  const organization = {
    listBranches: () =>
      Promise.resolve([{ id: BRANCH_ID, sync2booksBranchId: '00' }]),
    getEtimsConnectionForBranch: () =>
      Promise.resolve({
        kraPin: 'P600004185A',
        environment: 'SANDBOX',
        status: 'ACTIVE',
      }),
  };
  const oscuOperations = { sendPurchaseTransaction };
  const mainApiConnections = {
    resolveMerchantId: () => Promise.resolve(MERCHANT_ID),
  };

  const service = new DashboardPurchasesApplicationService(
    repo as never,
    syncStateRepo as never,
    catalogRepo as never,
    organization as never,
    oscuOperations as never,
    undefined as never,
    undefined as never,
    mainApiConnections as never,
    undefined as never,
  );

  return { service, row, store };
}

describe('DashboardPurchasesApplicationService.confirm -- invcNo drift self-heal', () => {
  it('corrects the purchases counter and the row, then retries once', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ success: false, error: DRIFT_ERROR })
      .mockResolvedValueOnce({ success: true });

    // Counter at 3 -> the row is allocated invcNo 4, while KRA wants 12.
    const { service, row, store } = makeService('3', send);
    const result = await service.confirm(TENANT_ID, ['purchase-1']);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][2].invcNo).toBe(4);
    expect(send.mock.calls[1][2].invcNo).toBe(12);

    // Counter and row both carry the corrected value: a later retry of this
    // row reuses row.kraConfirmInvcNo, so leaving it stale would re-drift.
    expect(store.get(SYNC_KEY)).toBe('12');
    expect(row.kraConfirmInvcNo).toBe(12);
    expect(row.confirmationStatus).toBe('confirmed');
    expect(result.errors).toHaveLength(0);
  });

  it('does not retry when KRA echoes back the value already sent', async () => {
    const send = jest.fn().mockResolvedValue({
      success: false,
      error: 'Invc No: 4 is invalid, use the expected value: 4',
    });

    const { service } = makeService('3', send);
    await service.confirm(TENANT_ID, ['purchase-1']);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('leaves a non-drift rejection to the existing release path', async () => {
    const send = jest.fn().mockResolvedValue({
      success: false,
      error: 'HTTP 400 calling OSCU: Invalid spplrTin',
    });

    const { service, row, store } = makeService('3', send);
    const result = await service.confirm(TENANT_ID, ['purchase-1']);

    expect(send).toHaveBeenCalledTimes(1);
    // releasePurchaseInvcNo rolls 4 back to 3 and clears the row's value.
    expect(store.get(SYNC_KEY)).toBe('3');
    expect(row.kraConfirmInvcNo).toBeNull();
    expect(result.errors).toHaveLength(1);
  });
});
