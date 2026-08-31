import { syncItemsToEtims } from './sync-items.usecase';
import type { CatalogItem } from '../../domain/entities/catalog-item.entity';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

function makeItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  const now = new Date();
  return {
    id: 'item-1',
    merchantId: 'merchant-1',
    externalId: 'ext-1',
    name: 'Widget',
    sku: 'SKU-1',
    taxCategory: TaxCategory.VAT_STANDARD,
    classificationCode: '14111400',
    classificationMethod: 'EXTERNAL_ID',
    needsClassificationReview: false,
    unitCode: 'NO',
    packagingUnitCode: 'NT',
    needsClassificationMapping: false,
    taxTyCd: 'B',
    productTypeCode: '2',
    needsProductType: false,
    unitPrice: null,
    originCountry: null,
    sourceSystem: null,
    isStockItem: true,
    registrationStatus: 'PENDING',
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

/** Stateful in-memory stand-in for the oscu_sync_state repo, so allocate/release
 * calls actually observe each other's effect on the counter within a test. */
function makeSyncStateRepo() {
  const store = new Map<string, string>();
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

describe('syncItemsToEtims', () => {
  it("sends the item's own unitPrice/originCountry as dftPrc/orgnNatCd instead of hardcoded 0/KE", async () => {
    const item = makeItem({ unitPrice: 1999.5, originCountry: 'CN' });
    let capturedRequest: any = null;

    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([item]),
      save: jest.fn().mockImplementation((i) => Promise.resolve(i)),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue({
        kraPin: 'P000000000A',
        kraBhfId: '00',
        cmcKey: 'cmc-key',
        deviceId: 'device-1',
        environment: 'SANDBOX',
      }),
    };
    const etimsAdapter = {
      saveItem: jest.fn().mockImplementation((request) => {
        capturedRequest = request;
        return Promise.resolve({
          success: true,
          rawResponse: { resultCd: '000', resultMsg: 'OK' },
        });
      }),
    };
    const syncStateRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    };

    const result = await syncItemsToEtims(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.synced).toBe(1);
    expect(capturedRequest.dftPrc).toBe(1999.5);
    expect(capturedRequest.orgnNatCd).toBe('CN');
  });

  it('falls back to 0/KE when unitPrice/originCountry are unset', async () => {
    const item = makeItem({ unitPrice: null, originCountry: null });
    let capturedRequest: any = null;

    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([item]),
      save: jest.fn().mockImplementation((i) => Promise.resolve(i)),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue({
        kraPin: 'P000000000A',
        kraBhfId: '00',
        cmcKey: 'cmc-key',
        deviceId: 'device-1',
        environment: 'SANDBOX',
      }),
    };
    const etimsAdapter = {
      saveItem: jest.fn().mockImplementation((request) => {
        capturedRequest = request;
        return Promise.resolve({
          success: true,
          rawResponse: { resultCd: '000', resultMsg: 'OK' },
        });
      }),
    };
    const syncStateRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    };

    await syncItemsToEtims(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(capturedRequest.dftPrc).toBe(0);
    expect(capturedRequest.orgnNatCd).toBe('KE');
  });

  it('releases the itemCd sequence and clears etimsItemCode on a permanent (non-retryable) rejection', async () => {
    const item = makeItem();
    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([item]),
      save: jest.fn().mockImplementation((i) => Promise.resolve(i)),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue({
        kraPin: 'P000000000A',
        kraBhfId: '00',
        cmcKey: 'cmc-key',
        deviceId: 'device-1',
        environment: 'SANDBOX',
      }),
    };
    const etimsAdapter = {
      saveItem: jest.fn().mockResolvedValue({
        success: false,
        error: 'OSCU 800 Invalid itemClsCd',
        rawResponse: { resultCd: '800', resultMsg: 'Invalid itemClsCd' },
      }),
    };
    const syncStateRepo = makeSyncStateRepo();

    const result = await syncItemsToEtims(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.failed).toBe(1);
    // Sequence was allocated as 1, then released back to 0 by the rejection.
    expect(syncStateRepo._store.get('item_cd_seq:P000000000A:SANDBOX')).toBe(
      '0',
    );
    const savedItem = itemRepo.save.mock.calls[0][0];
    expect(savedItem.etimsItemCode).toBeNull();
    expect(savedItem.registrationStatus).toBe('FAILED');
  });

  it('falls back to res.error when rawResponse carries blank resultCd/resultMsg (e.g. a gateway-level rejection with no KRA envelope)', async () => {
    const item = makeItem();
    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([item]),
      save: jest.fn().mockImplementation((i) => Promise.resolve(i)),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue({
        kraPin: 'P000000000A',
        kraBhfId: '00',
        cmcKey: 'cmc-key',
        deviceId: 'device-1',
        environment: 'SANDBOX',
      }),
    };
    const etimsAdapter = {
      // Mirrors etims-adapter.http.ts's `!ok` branch: rawResponse is always
      // constructed (via safeString()), so resultCd/resultMsg come back as
      // '' rather than undefined when the raw body has no KRA envelope --
      // e.g. an Apigee/HTTP-level rejection that never reached KRA itself.
      saveItem: jest.fn().mockResolvedValue({
        success: false,
        error: 'Gateway timeout (504)',
        rawResponse: { resultCd: '', resultMsg: '' },
      }),
    };
    const syncStateRepo = makeSyncStateRepo();

    await syncItemsToEtims(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    const savedItem = itemRepo.save.mock.calls[0][0];
    // A blank resultCd/resultMsg must not persist as '' -- that renders as
    // "no error" in the item detail drawer (lastSyncResultMsg is falsy),
    // silently hiding the one piece of information a merchant/support
    // agent needs. It must fall back to res.error instead.
    expect(savedItem.lastSyncResultCd).toBeNull();
    expect(savedItem.lastSyncResultMsg).toBe('Gateway timeout (504)');
  });

  it('keeps the itemCd and does not release the sequence on a retryable (network) failure', async () => {
    const item = makeItem();
    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([item]),
      save: jest.fn().mockImplementation((i) => Promise.resolve(i)),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue({
        kraPin: 'P000000000A',
        kraBhfId: '00',
        cmcKey: 'cmc-key',
        deviceId: 'device-1',
        environment: 'SANDBOX',
      }),
    };
    const etimsAdapter = {
      saveItem: jest.fn().mockResolvedValue({
        success: false,
        error: 'retryable: fetch failed',
      }),
    };
    const syncStateRepo = makeSyncStateRepo();

    const result = await syncItemsToEtims(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.failed).toBe(1);
    // Sequence stays at 1 -- a retry of this same item must reuse it.
    expect(syncStateRepo._store.get('item_cd_seq:P000000000A:SANDBOX')).toBe(
      '1',
    );
    const savedItem = itemRepo.save.mock.calls[0][0];
    expect(savedItem.etimsItemCode).toBe('KE2NTNO0000001');
    expect(savedItem.registrationStatus).toBe('FAILED');
    // res.rawResponse is undefined for a network-level failure -- there's no
    // KRA resultCd/resultMsg to persist, but the real reason (res.error)
    // must still be saved, or the item detail drawer's "Error from KRA /
    // backend" section (gated on lastSyncResultMsg being set) stays silent
    // forever for exactly the failures a merchant/support agent most needs
    // to see.
    expect(savedItem.lastSyncResultCd).toBeNull();
    expect(savedItem.lastSyncResultMsg).toBe('retryable: fetch failed');
  });

  /**
   * Regression for the 2026-08-31 shared-sandbox-tin incident: a database
   * whose local item_cd_seq counter has fallen behind what KRA actually
   * expects for this tin (e.g. because another environment also submits to
   * it) must self-heal by advancing the counter and resubmitting, not get
   * stuck resubmitting the same rejected value forever.
   */
  it('self-heals an itemCd sequence drift rejection by advancing the counter and resubmitting', async () => {
    const item = makeItem();
    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([item]),
      save: jest.fn().mockImplementation((i) => Promise.resolve(i)),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue({
        kraPin: 'P600004185A',
        kraBhfId: '00',
        cmcKey: 'cmc-key',
        deviceId: 'device-1',
        environment: 'SANDBOX',
      }),
    };
    // Rejects the first two attempts as drift (mirrors the live KRA
    // response), then accepts the third.
    const saveItem = jest
      .fn()
      .mockResolvedValueOnce({
        success: false,
        error: undefined,
        rawResponse: {
          resultCd: '',
          resultMsg:
            'The itemCd is either reused or not incremented properly. Expected sequence ending with ********11',
        },
      })
      .mockResolvedValueOnce({
        success: false,
        error: undefined,
        rawResponse: {
          resultCd: '',
          resultMsg:
            'The itemCd is either reused or not incremented properly. Expected sequence ending with ********11',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        rawResponse: { resultCd: '000', resultMsg: 'OK' },
      });
    const etimsAdapter = { saveItem };
    const syncStateRepo = makeSyncStateRepo();

    const result = await syncItemsToEtims(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(saveItem).toHaveBeenCalledTimes(3);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    // Counter advanced through all three allocations (1, 2, 3) -- not
    // released back down after the two drift rejections.
    expect(syncStateRepo._store.get('item_cd_seq:P600004185A:SANDBOX')).toBe(
      '3',
    );
    const savedItem = itemRepo.save.mock.calls[0][0];
    expect(savedItem.etimsItemCode).toBe('KE2NTNO0000003');
    expect(savedItem.registrationStatus).toBe('REGISTERED');
  });

  it('gives up after MAX_ITEM_CD_DRIFT_RETRIES and fails visibly without releasing the advanced counter', async () => {
    const item = makeItem();
    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([item]),
      save: jest.fn().mockImplementation((i) => Promise.resolve(i)),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue({
        kraPin: 'P600004185A',
        kraBhfId: '00',
        cmcKey: 'cmc-key',
        deviceId: 'device-1',
        environment: 'SANDBOX',
      }),
    };
    const saveItem = jest.fn().mockResolvedValue({
      success: false,
      error: undefined,
      rawResponse: {
        resultCd: '',
        resultMsg:
          'The itemCd is either reused or not incremented properly. Expected sequence ending with ********11',
      },
    });
    const etimsAdapter = { saveItem };
    const syncStateRepo = makeSyncStateRepo();

    const result = await syncItemsToEtims(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    // 1 initial attempt + MAX_ITEM_CD_DRIFT_RETRIES self-heal retries.
    expect(saveItem).toHaveBeenCalledTimes(26);
    expect(result.failed).toBe(1);
    // Stayed at 26, not released back down -- releasing would just
    // reproduce the identical failure on the next attempt.
    expect(syncStateRepo._store.get('item_cd_seq:P600004185A:SANDBOX')).toBe(
      '26',
    );
    const savedItem = itemRepo.save.mock.calls[0][0];
    expect(savedItem.registrationStatus).toBe('FAILED');
  });

  /**
   * Regression: an item pulled with no approved classification_mappings row
   * now still registers locally (registerItem no longer throws -- see
   * register-item.spec.ts's "4)"/"4b)" tests), so it can reach this
   * function with '' classificationCode/unitCode/packagingUnitCode.
   * saveItem requires all three -- this must skip the item with a clear
   * reason instead of submitting blank codes to KRA or crashing the batch.
   */
  it('skips an item missing classification/unit codes instead of submitting blank codes to KRA', async () => {
    const item = makeItem({
      classificationCode: '',
      unitCode: '',
      packagingUnitCode: '',
      needsClassificationMapping: true,
    });
    const itemRepo = {
      findByMerchant: jest.fn().mockResolvedValue([item]),
      save: jest.fn().mockImplementation((i) => Promise.resolve(i)),
    };
    const connectionRepo = {
      findByMerchantAndBranch: jest.fn().mockResolvedValue({
        kraPin: 'P000000000A',
        kraBhfId: '00',
        cmcKey: 'cmc-key',
        deviceId: 'device-1',
        environment: 'SANDBOX',
      }),
    };
    const etimsAdapter = { saveItem: jest.fn() };
    const syncStateRepo = makeSyncStateRepo();

    const result = await syncItemsToEtims(
      { merchantId: 'merchant-1', branchId: 'branch-1' },
      {
        itemRepo: itemRepo as any,
        connectionRepo: connectionRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
      },
    );

    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
    expect(etimsAdapter.saveItem).not.toHaveBeenCalled();
    expect(itemRepo.save).not.toHaveBeenCalled();
    expect(result.results[0].error).toMatch(
      /classification and\/or unit codes/i,
    );
  });
});
