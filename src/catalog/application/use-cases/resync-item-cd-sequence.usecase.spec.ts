import { resyncItemCdSequenceFromKra } from './resync-item-cd-sequence.usecase';
import type { CatalogItem } from '../../domain/entities/catalog-item.entity';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

function makeItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  const now = new Date();
  return {
    id: 'item-1',
    merchantId: 'merchant-1',
    externalId: 'ext-1',
    name: 'vehicle parts',
    sku: null,
    taxCategory: TaxCategory.OTHER,
    classificationCode: '1010151800',
    classificationMethod: 'EXTERNAL_ID',
    needsClassificationReview: false,
    unitCode: '4B',
    packagingUnitCode: 'AM',
    needsClassificationMapping: false,
    taxTyCd: 'D',
    productTypeCode: '1',
    needsProductType: false,
    unitPrice: null,
    originCountry: null,
    sourceSystem: null,
    isStockItem: true,
    registrationStatus: 'FAILED',
    etimsItemCode: null,
    lastSyncResultCd: null,
    lastSyncResultMsg: null,
    lastSyncAttemptAt: null,
    version: 1,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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

const kraItemList = [
  {
    tin: 'P600004185A',
    itemCd: 'KE2NTNO0000001',
    itemClsCd: '1010150000',
    itemTyCd: '2',
    itemNm: 'Go Live Test Item 2',
    pkgUnitCd: 'NT',
    qtyUnitCd: 'NO',
  },
  {
    tin: 'P600004185A',
    itemCd: 'KE1AM4B0000011',
    itemClsCd: '1010151800',
    itemTyCd: '1',
    itemNm: 'vehicle parts',
    pkgUnitCd: 'AM',
    qtyUnitCd: '4B',
  },
];

describe('resyncItemCdSequenceFromKra', () => {
  it("advances the local counter to KRA's real max sequence when local has fallen behind", async () => {
    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue(connection),
    };
    const etimsAdapter = {
      getItemInfo: jest.fn().mockResolvedValue({
        success: true,
        rawResponse: { resultCd: '000', data: { itemList: kraItemList } },
      }),
    };
    const syncStateRepo = makeSyncStateRepo({
      'item_cd_seq:P600004185A:SANDBOX': '1',
    });

    const result = await resyncItemCdSequenceFromKra(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.maxSeqFromKra).toBe(11);
    expect(result.previousCounter).toBe(1);
    expect(result.newCounter).toBe(11);
    expect(syncStateRepo._store.get('item_cd_seq:P600004185A:SANDBOX')).toBe(
      '11',
    );
  });

  it('never regresses the counter when the local value is already ahead of KRA', async () => {
    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue(connection),
    };
    const etimsAdapter = {
      getItemInfo: jest.fn().mockResolvedValue({
        success: true,
        rawResponse: { resultCd: '000', data: { itemList: kraItemList } },
      }),
    };
    const syncStateRepo = makeSyncStateRepo({
      'item_cd_seq:P600004185A:SANDBOX': '25',
    });

    const result = await resyncItemCdSequenceFromKra(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.newCounter).toBe(25);
    expect(syncStateRepo._store.get('item_cd_seq:P600004185A:SANDBOX')).toBe(
      '25',
    );
  });

  it('backfills a local item KRA already has registered (matched on classification + units + product type + name)', async () => {
    const stuckItem = makeItem({
      registrationStatus: 'FAILED',
      etimsItemCode: null,
    });
    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([stuckItem]),
      save: jest.fn().mockImplementation((i) => Promise.resolve(i)),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue(connection),
    };
    const etimsAdapter = {
      getItemInfo: jest.fn().mockResolvedValue({
        success: true,
        rawResponse: { resultCd: '000', data: { itemList: kraItemList } },
      }),
    };
    const syncStateRepo = makeSyncStateRepo();

    const result = await resyncItemCdSequenceFromKra(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.reconciled).toEqual([
      { itemId: 'item-1', itemCd: 'KE1AM4B0000011' },
    ]);
    const saved = itemRepo.save.mock.calls[0][0];
    expect(saved.etimsItemCode).toBe('KE1AM4B0000011');
    expect(saved.registrationStatus).toBe('REGISTERED');
  });

  it('does not reconcile a local item whose attributes differ from every KRA record, even with the same name', async () => {
    const differentItem = makeItem({
      name: 'vehicle parts',
      classificationCode: '1010151200',
      productTypeCode: '2',
      packagingUnitCode: 'BA',
      unitCode: 'AV',
      registrationStatus: 'PENDING',
    });
    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([differentItem]),
      save: jest.fn(),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue(connection),
    };
    const etimsAdapter = {
      getItemInfo: jest.fn().mockResolvedValue({
        success: true,
        rawResponse: { resultCd: '000', data: { itemList: kraItemList } },
      }),
    };
    const syncStateRepo = makeSyncStateRepo();

    const result = await resyncItemCdSequenceFromKra(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.reconciled).toEqual([]);
    expect(itemRepo.save).not.toHaveBeenCalled();
  });

  it('skips an already-REGISTERED local item even if it happens to match a KRA record', async () => {
    const alreadyRegistered = makeItem({
      registrationStatus: 'REGISTERED',
      etimsItemCode: 'KE1AM4B0000011',
    });
    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([alreadyRegistered]),
      save: jest.fn(),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue(connection),
    };
    const etimsAdapter = {
      getItemInfo: jest.fn().mockResolvedValue({
        success: true,
        rawResponse: { resultCd: '000', data: { itemList: kraItemList } },
      }),
    };
    const syncStateRepo = makeSyncStateRepo();

    const result = await resyncItemCdSequenceFromKra(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.reconciled).toEqual([]);
    expect(itemRepo.save).not.toHaveBeenCalled();
  });
});
