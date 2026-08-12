import type { Repository } from 'typeorm';
import type { IComplianceConnectionRepository } from '../../../shared/ports/repository.port';
import type { IEtimsAdapter } from '../../../regulatory/oscu/ports/etims-adapter.port';
import type { OscuCodeClsRow } from '../../../regulatory/oscu/transport/endpoints/code-search.dto';
import { OscuCodeClassOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-code-class.orm-entity';
import { OscuCodeOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-code.orm-entity';
import { OscuSyncStateOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';

/**
 * KRA's own sample `lastReqDt` for a first-ever pull (OSCU spec §3.3.2.1 JSON SAMPLE).
 * Used only when we have no stored watermark for this environment yet.
 */
const EPOCH_LAST_REQ_DT = '20180520000000';

export interface SyncCodeListInput {
  /** Any merchant/branch with a provisioned OSCU connection — the fetched list is global, not merchant-scoped. */
  merchantId: string;
  branchId: string;
  /** Ignore the stored watermark and re-pull the full reference list. */
  full?: boolean;
}

export interface SyncCodeListResult {
  environment: string;
  groupsFetched: number;
  codesFetched: number;
  lastReqDt: string;
}

function formatYyyyMMddhhmmssUtc(date: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}` +
    `${pad2(date.getUTCMonth() + 1)}` +
    `${pad2(date.getUTCDate())}` +
    `${pad2(date.getUTCHours())}` +
    `${pad2(date.getUTCMinutes())}` +
    `${pad2(date.getUTCSeconds())}`
  );
}

function isCodeListPayload(
  value: unknown,
): value is { clsList: OscuCodeClsRow[] } {
  if (!value || typeof value !== 'object') return false;
  const list = (value as { clsList?: unknown }).clsList;
  return Array.isArray(list);
}

export async function syncCodeList(
  input: SyncCodeListInput,
  deps: {
    connectionRepo: IComplianceConnectionRepository;
    etimsAdapter: IEtimsAdapter;
    codeClassRepo: Repository<OscuCodeClassOrmEntity>;
    codeRepo: Repository<OscuCodeOrmEntity>;
    syncStateRepo: Repository<OscuSyncStateOrmEntity>;
  },
): Promise<SyncCodeListResult> {
  const connection = await deps.connectionRepo.findByMerchantAndBranch(
    input.merchantId,
    input.branchId,
  );
  if (!connection) {
    throw new Error(
      `No active eTIMS connection for merchant=${input.merchantId} branch=${input.branchId}`,
    );
  }
  if (!connection.kraBhfId) {
    throw new Error(
      `Branch ${input.branchId} has no KRA branch office id (kraBhfId) set`,
    );
  }

  const syncKey = `code_list:${connection.environment}`;
  const watermark = input.full
    ? null
    : await deps.syncStateRepo.findOne({ where: { syncKey } });
  const lastReqDt = watermark?.lastReqDt ?? EPOCH_LAST_REQ_DT;

  const envelope = await deps.etimsAdapter.selectCodeList(
    {
      tin: connection.kraPin,
      bhfId: connection.kraBhfId,
      cmcKey: connection.cmcKey,
      lastReqDt,
    },
    {
      merchantId: input.merchantId,
      branchId: connection.kraBhfId,
      kraPin: connection.kraPin,
      environment: connection.environment,
      cmcKey: connection.cmcKey,
      deviceId: connection.deviceId,
    },
  );

  // `resultCd: "001"` ("There is no search result") is KRA's documented way of saying
  // "nothing new since your watermark" -- a valid empty response, not a failure. Without
  // this, an incremental sync that legitimately has nothing new throws and surfaces as an
  // uncaught 500, even though the OSCU call itself succeeded.
  const resultCd = envelope.rawResponse?.['resultCd'];
  const noNewResults = resultCd === '001';
  if (!envelope.success && !noNewResults) {
    throw new Error(envelope.error ?? 'Failed to fetch code list from OSCU');
  }

  const data = envelope.rawResponse?.['data'];
  const groups = isCodeListPayload(data) ? data.clsList : [];
  const now = new Date();

  if (groups.length > 0) {
    await deps.codeClassRepo.upsert(
      groups.map((g) => ({
        cdCls: g.cdCls,
        cdClsNm: g.cdClsNm,
        cdClsDesc: g.cdClsDesc,
        userDfnNm1: g.userDfnNm1,
        userDfnNm2: g.userDfnNm2,
        userDfnNm3: g.userDfnNm3,
        useYn: g.useYn,
      })),
      ['cdCls'],
    );
  }

  const codeRows = groups.flatMap((g) =>
    g.dtlList.map((d) => ({
      cdCls: g.cdCls,
      cd: d.cd,
      cdNm: d.cdNm,
      cdDesc: d.cdDesc,
      srtOrd: d.srtOrd,
      useYn: d.useYn,
      userDfnCd1: d.userDfnCd1,
      userDfnCd2: d.userDfnCd2,
      userDfnCd3: d.userDfnCd3,
    })),
  );

  if (codeRows.length > 0) {
    await deps.codeRepo.upsert(codeRows, ['cdCls', 'cd']);
  }

  const resultDt =
    typeof envelope.rawResponse?.['resultDt'] === 'string'
      ? envelope.rawResponse['resultDt']
      : formatYyyyMMddhhmmssUtc(now);

  await deps.syncStateRepo.upsert({ syncKey, lastReqDt: resultDt }, [
    'syncKey',
  ]);

  return {
    environment: connection.environment,
    groupsFetched: groups.length,
    codesFetched: codeRows.length,
    lastReqDt: resultDt,
  };
}
