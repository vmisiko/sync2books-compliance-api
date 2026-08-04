import type { Repository } from 'typeorm';
import type { IComplianceConnectionRepository } from '../../../shared/ports/repository.port';
import type { IEtimsAdapter } from '../../../regulatory/oscu/ports/etims-adapter.port';
import type { OscuItemClassListRow } from '../../../regulatory/oscu/transport/endpoints/item-class-list.dto';
import { OscuItemClassificationOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-item-classification.orm-entity';
import { OscuSyncStateOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';

/**
 * KRA's own sample `lastReqDt` for a first-ever pull (OSCU spec §3.3.3.1 JSON SAMPLE).
 * Used only when we have no stored watermark for this environment yet.
 */
const EPOCH_LAST_REQ_DT = '20180523000000';

export interface SyncItemClassificationsInput {
  /** Any merchant/branch with a provisioned OSCU connection — the fetched list is global, not merchant-scoped. */
  merchantId: string;
  branchId: string;
  /** Ignore the stored watermark and re-pull the full reference list. */
  full?: boolean;
}

export interface SyncItemClassificationsResult {
  environment: string;
  fetched: number;
  upserted: number;
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

function isItemClsListPayload(
  value: unknown,
): value is { itemClsList: OscuItemClassListRow[] } {
  if (!value || typeof value !== 'object') return false;
  const list = (value as { itemClsList?: unknown }).itemClsList;
  return Array.isArray(list);
}

export async function syncItemClassifications(
  input: SyncItemClassificationsInput,
  deps: {
    connectionRepo: IComplianceConnectionRepository;
    etimsAdapter: IEtimsAdapter;
    classificationRepo: Repository<OscuItemClassificationOrmEntity>;
    syncStateRepo: Repository<OscuSyncStateOrmEntity>;
  },
): Promise<SyncItemClassificationsResult> {
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

  const syncKey = `item_cls_list:${connection.environment}`;
  const watermark = input.full
    ? null
    : await deps.syncStateRepo.findOne({ where: { syncKey } });
  const lastReqDt = watermark?.lastReqDt ?? EPOCH_LAST_REQ_DT;

  const envelope = await deps.etimsAdapter.selectItemClsList(
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

  if (!envelope.success) {
    throw new Error(
      envelope.error ?? 'Failed to fetch item classification list from OSCU',
    );
  }

  const data = envelope.rawResponse?.['data'];
  const rows = isItemClsListPayload(data) ? data.itemClsList : [];
  const now = new Date();

  if (rows.length > 0) {
    await deps.classificationRepo.upsert(
      rows.map((row) => ({
        itemClsCd: row.itemClsCd,
        itemClsNm: row.itemClsNm,
        itemClsLvl: row.itemClsLvl,
        taxTyCd: row.taxTyCd,
        mjrTgYn: row.mjrTgYn,
        useYn: row.useYn,
        lastSyncedAt: now,
      })),
      ['itemClsCd'],
    );
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
    fetched: rows.length,
    upserted: rows.length,
    lastReqDt: resultDt,
  };
}
