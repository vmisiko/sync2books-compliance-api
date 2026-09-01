import { CatalogService } from './catalog.service';
import type { IComplianceConnectionRepository } from '../../shared/ports/repository.port';
import type { IEtimsAdapter } from '../../regulatory/oscu/ports/etims-adapter.port';
import { ConnectionEnvironment } from '../../shared/domain/enums/connection-environment.enum';
import { ConnectionStatus } from '../../shared/domain/enums/connection-status.enum';
import type { ComplianceConnection } from '../../shared/domain/entities/compliance-connection.entity';

function fakeConnection(
  environment: ConnectionEnvironment,
  merchantId: string,
): ComplianceConnection {
  return {
    id: `conn-${environment}`,
    merchantId,
    kraPin: 'P1234567890',
    branchId: 'branch-1',
    kraBhfId: '00',
    deviceId: 'device-1',
    dvcSrlNo: null,
    environment,
    status: ConnectionStatus.ACTIVE,
    cmcKey: 'cmc-key-1',
    lastCodeSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** No-op repo satisfying whichever of upsert/findOne a given usecase calls. */
function fakeRepo() {
  return {
    upsert: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(null),
  };
}

function makeService(params: {
  connections: Partial<
    Record<ConnectionEnvironment, ComplianceConnection | null>
  >;
  selectCodeList?: jest.Mock;
  selectItemClsList?: jest.Mock;
}) {
  const connectionRepo: Pick<
    IComplianceConnectionRepository,
    'findAnyConnected' | 'findByMerchantAndBranch'
  > = {
    findAnyConnected: jest.fn((environment: ConnectionEnvironment) =>
      Promise.resolve(params.connections[environment] ?? null),
    ),
    findByMerchantAndBranch: jest.fn((merchantId: string) => {
      const match = Object.values(params.connections).find(
        (c) => c && c.merchantId === merchantId,
      );
      return Promise.resolve(match ?? null);
    }),
  };

  const selectCodeList =
    params.selectCodeList ??
    jest.fn().mockResolvedValue({
      success: true,
      rawResponse: { data: { clsList: [] }, resultDt: '20260831000000' },
    });
  const selectItemClsList =
    params.selectItemClsList ??
    jest.fn().mockResolvedValue({
      success: true,
      rawResponse: { data: { itemClsList: [] }, resultDt: '20260831000000' },
    });
  const etimsAdapter: Pick<
    IEtimsAdapter,
    'selectCodeList' | 'selectItemClsList'
  > = { selectCodeList, selectItemClsList };

  const service = new CatalogService(
    undefined as any, // itemRepo — unused by syncReferenceDataFromOscu
    undefined as any, // classificationResolver
    connectionRepo as unknown as IComplianceConnectionRepository,
    etimsAdapter as unknown as IEtimsAdapter,
    undefined as any, // stockRepo
    undefined as any, // inventory — unused by syncReferenceDataFromOscu
    undefined as any, // organization
    fakeRepo() as any, // itemClassificationRepo
    fakeRepo() as any, // oscuSyncStateRepo
    fakeRepo() as any, // codeClassRepo
    fakeRepo() as any, // codeRepo
  );

  return { service, connectionRepo, selectCodeList, selectItemClsList };
}

describe('CatalogService.syncReferenceDataFromOscu', () => {
  it('skips an environment with no ACTIVE connection instead of throwing', async () => {
    const { service, selectCodeList, selectItemClsList } = makeService({
      connections: {},
    });

    const results = await service.syncReferenceDataFromOscu();
    expect(results).toEqual([
      { environment: ConnectionEnvironment.SANDBOX, skipped: true },
      { environment: ConnectionEnvironment.PRODUCTION, skipped: true },
    ]);
    expect(selectCodeList).not.toHaveBeenCalled();
    expect(selectItemClsList).not.toHaveBeenCalled();
  });

  it('syncs codes and item classifications for whichever environments have a connection, using that connection as credentials', async () => {
    const sandboxConn = fakeConnection(
      ConnectionEnvironment.SANDBOX,
      'merchant-sandbox',
    );
    const { service, selectCodeList, selectItemClsList } = makeService({
      connections: { [ConnectionEnvironment.SANDBOX]: sandboxConn },
    });

    const results = await service.syncReferenceDataFromOscu();

    expect(selectCodeList).toHaveBeenCalledTimes(1);
    expect(selectCodeList).toHaveBeenCalledWith(
      expect.objectContaining({
        tin: sandboxConn.kraPin,
        bhfId: sandboxConn.kraBhfId,
      }),
      expect.objectContaining({ merchantId: sandboxConn.merchantId }),
    );
    expect(selectItemClsList).toHaveBeenCalledTimes(1);
    expect(selectItemClsList).toHaveBeenCalledWith(
      expect.objectContaining({
        tin: sandboxConn.kraPin,
        bhfId: sandboxConn.kraBhfId,
      }),
      expect.objectContaining({ merchantId: sandboxConn.merchantId }),
    );

    const sandboxResult = results.find(
      (r) => r.environment === ConnectionEnvironment.SANDBOX,
    );
    expect(sandboxResult?.skipped).toBe(false);
    expect(sandboxResult?.codes).toBeDefined();
    expect(sandboxResult?.classifications).toBeDefined();
    expect(sandboxResult?.codesError).toBeUndefined();
    expect(sandboxResult?.classificationsError).toBeUndefined();
  });

  it("a code-list sync failure for one environment does not block that environment's item-classification sync", async () => {
    const sandboxConn = fakeConnection(
      ConnectionEnvironment.SANDBOX,
      'merchant-sandbox',
    );
    const selectCodeList = jest.fn().mockRejectedValue(new Error('OSCU down'));
    const { service, selectItemClsList } = makeService({
      connections: { [ConnectionEnvironment.SANDBOX]: sandboxConn },
      selectCodeList,
    });

    const results = await service.syncReferenceDataFromOscu();
    expect(selectItemClsList).toHaveBeenCalledTimes(1);

    const sandboxResult = results.find(
      (r) => r.environment === ConnectionEnvironment.SANDBOX,
    );
    expect(sandboxResult?.codesError).toBe('OSCU down');
    expect(sandboxResult?.classifications).toBeDefined();
  });

  it('syncs both environments independently when both have a connection', async () => {
    const sandboxConn = fakeConnection(
      ConnectionEnvironment.SANDBOX,
      'merchant-sandbox',
    );
    const prodConn = fakeConnection(
      ConnectionEnvironment.PRODUCTION,
      'merchant-prod',
    );
    const { service, selectCodeList, selectItemClsList } = makeService({
      connections: {
        [ConnectionEnvironment.SANDBOX]: sandboxConn,
        [ConnectionEnvironment.PRODUCTION]: prodConn,
      },
    });

    await service.syncReferenceDataFromOscu();

    expect(selectCodeList).toHaveBeenCalledTimes(2);
    expect(selectItemClsList).toHaveBeenCalledTimes(2);
  });

  it('threads full:true through to both underlying syncs (on-demand re-pull, not just incremental)', async () => {
    const sandboxConn = fakeConnection(
      ConnectionEnvironment.SANDBOX,
      'merchant-sandbox',
    );
    const { service } = makeService({
      connections: { [ConnectionEnvironment.SANDBOX]: sandboxConn },
    });
    const syncCodeListSpy = jest.spyOn(service, 'syncCodeList');
    const syncItemClassificationsSpy = jest.spyOn(
      service,
      'syncItemClassifications',
    );

    await service.syncReferenceDataFromOscu(true);

    expect(syncCodeListSpy).toHaveBeenCalledWith(
      expect.objectContaining({ full: true }),
    );
    expect(syncItemClassificationsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ full: true }),
    );
  });
});

describe('CatalogService.syncItems -- stock master catch-up', () => {
  /**
   * Regression (2026-09-01): stock reconciled while an item was still
   * PENDING (e.g. from "Pull from QuickBooks", which reconciles qtyOnHand
   * immediately on pull) never reached KRA -- syncStockMasterToEtims gates
   * on etimsItemCode being set, and item-sync (sync-items.usecase.ts) had
   * no knowledge of inventory at all, so nothing re-sent it once
   * registration completed. CatalogService.syncItems must now call
   * InventoryService.pushStockMasterCatchUp for every item that just
   * registered successfully, so KRA gets caught up in the same request
   * that completed registration.
   */
  it('pushes a stock master catch-up for every item that just registered successfully', async () => {
    const item = {
      id: 'item-1',
      merchantId: 'merchant-1',
      externalId: 'ext-1',
      name: 'Widget',
      sku: null,
      taxCategory: 'OTHER',
      classificationCode: '1010150000',
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };
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
        success: true,
        rawResponse: { resultCd: '000', resultMsg: 'OK' },
      }),
    };
    const syncStateRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const pushStockMasterCatchUp = jest.fn().mockResolvedValue(undefined);
    const inventory = { pushStockMasterCatchUp };

    const service = new CatalogService(
      itemRepo as any,
      undefined as any, // classificationResolver
      connectionRepo as any,
      etimsAdapter as any,
      undefined as any, // stockRepo
      inventory as any,
      undefined as any, // organization
      undefined as any, // itemClassificationRepo
      syncStateRepo as any, // oscuSyncStateRepo
      undefined as any, // codeClassRepo
      undefined as any, // codeRepo
    );

    await service.syncItems({ merchantId: 'merchant-1', branchId: 'branch-1' });

    expect(pushStockMasterCatchUp).toHaveBeenCalledWith('item-1', 'branch-1');
  });

  it('does not push a catch-up for an item that failed to register', async () => {
    const item = {
      id: 'item-1',
      merchantId: 'merchant-1',
      externalId: 'ext-1',
      name: 'Widget',
      sku: null,
      taxCategory: 'OTHER',
      classificationCode: '1010150000',
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };
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
        error: 'OSCU 800 rejected',
        rawResponse: { resultCd: '800', resultMsg: 'rejected' },
      }),
    };
    const syncStateRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const pushStockMasterCatchUp = jest.fn().mockResolvedValue(undefined);
    const inventory = { pushStockMasterCatchUp };

    const service = new CatalogService(
      itemRepo as any,
      undefined as any,
      connectionRepo as any,
      etimsAdapter as any,
      undefined as any,
      inventory as any,
      undefined as any,
      undefined as any,
      syncStateRepo as any,
      undefined as any,
      undefined as any,
    );

    await service.syncItems({ merchantId: 'merchant-1', branchId: 'branch-1' });

    expect(pushStockMasterCatchUp).not.toHaveBeenCalled();
  });
});
