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
