import { resyncInvoiceSequenceFromKra } from './resync-invoice-sequence.usecase';

function makeSyncStateRepo(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    findOne: jest
      .fn()
      .mockImplementation(({ where: { syncKey } }) =>
        Promise.resolve(
          store.has(syncKey)
            ? { syncKey, lastReqDt: store.get(syncKey) }
            : null,
        ),
      ),
    upsert: jest.fn().mockImplementation(({ syncKey, lastReqDt }) => {
      store.set(syncKey, lastReqDt);
      return Promise.resolve(undefined);
    }),
    _store: store,
  };
}

const connection = {
  merchantId: 'merchant-1',
  branchId: 'branch-1',
  kraPin: 'P600004185A',
  kraBhfId: '00',
  cmcKey: 'cmc-key',
  deviceId: 'device-1',
  environment: 'SANDBOX',
};

const kraSalesList = [
  { invcNo: 1, orgInvcNo: 0 },
  { invcNo: 3, orgInvcNo: 0 },
  { invcNo: 6, orgInvcNo: 0 },
  { invcNo: 5, orgInvcNo: 0 },
];

describe('resyncInvoiceSequenceFromKra', () => {
  it("advances the local counter to KRA's real max invcNo when local has fallen behind", async () => {
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue(connection),
    };
    const etimsAdapter = {
      selectSalesTransactions: jest.fn().mockResolvedValue({
        success: true,
        rawResponse: { resultCd: '000', data: { salesList: kraSalesList } },
      }),
    };
    const syncStateRepo = makeSyncStateRepo({
      'invoice_seq:P600004185A:SANDBOX': '2',
    });

    const result = await resyncInvoiceSequenceFromKra(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.maxInvcNoFromKra).toBe(6);
    expect(result.previousCounter).toBe(2);
    expect(result.newCounter).toBe(6);
    expect(syncStateRepo._store.get('invoice_seq:P600004185A:SANDBOX')).toBe(
      '6',
    );
  });

  it('is a no-op when the local counter already matches KRA', async () => {
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue(connection),
    };
    const etimsAdapter = {
      selectSalesTransactions: jest.fn().mockResolvedValue({
        success: true,
        rawResponse: { resultCd: '000', data: { salesList: kraSalesList } },
      }),
    };
    const syncStateRepo = makeSyncStateRepo({
      'invoice_seq:P600004185A:SANDBOX': '6',
    });

    const result = await resyncInvoiceSequenceFromKra(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.newCounter).toBe(6);
    expect(syncStateRepo.upsert).not.toHaveBeenCalled();
  });

  it('never regresses the counter when the local value is already ahead of KRA', async () => {
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue(connection),
    };
    const etimsAdapter = {
      selectSalesTransactions: jest.fn().mockResolvedValue({
        success: true,
        rawResponse: { resultCd: '000', data: { salesList: kraSalesList } },
      }),
    };
    const syncStateRepo = makeSyncStateRepo({
      'invoice_seq:P600004185A:SANDBOX': '20',
    });

    const result = await resyncInvoiceSequenceFromKra(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.newCounter).toBe(20);
    expect(syncStateRepo.upsert).not.toHaveBeenCalled();
  });
});
