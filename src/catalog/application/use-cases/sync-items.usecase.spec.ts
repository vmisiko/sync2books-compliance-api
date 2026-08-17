import { syncItemsToEtims } from './sync-items.usecase';
import type { CatalogItem } from '../../domain/entities/catalog-item.entity';
import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

function makeItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  const now = new Date();
  return {
    id: 'item-1',
    merchantId: 'merchant-1',
    externalId: 'ext-1',
    name: 'Widget',
    sku: 'SKU-1',
    itemType: ItemType.GOODS,
    taxCategory: TaxCategory.VAT_STANDARD,
    classificationCode: '14111400',
    unitCode: 'NO',
    packagingUnitCode: 'NT',
    taxTyCd: 'B',
    productTypeCode: '2',
    unitPrice: null,
    originCountry: null,
    isStockItem: true,
    stockItemOverride: null,
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

describe('syncItemsToEtims', () => {
  it('sends the item\'s own unitPrice/originCountry as dftPrc/orgnNatCd instead of hardcoded 0/KE', async () => {
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
        return Promise.resolve({ success: true, rawResponse: { resultCd: '000', resultMsg: 'OK' } });
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
        return Promise.resolve({ success: true, rawResponse: { resultCd: '000', resultMsg: 'OK' } });
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
});
