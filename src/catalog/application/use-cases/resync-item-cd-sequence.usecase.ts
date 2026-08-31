import type { Repository } from 'typeorm';
import type { ICatalogItemRepository } from '../../domain/ports/item-repository.port';
import type { IComplianceConnectionRepository } from '../../../shared/ports/repository.port';
import type { IEtimsAdapter } from '../../../regulatory/oscu/ports/etims-adapter.port';
import type { OscuItemSearchRow } from '../../../regulatory/oscu/transport/endpoints/item-search.dto';
import { OscuSyncStateOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';

/** KRA's own sample `lastReqDt` for a first-ever pull (OSCU spec §3.3.3.1 JSON SAMPLE). */
const EPOCH_LAST_REQ_DT = '20180523000000';

export interface ResyncItemCdSequenceInput {
  merchantId: string;
  branchId: string;
}

export interface ResyncItemCdSequenceResult {
  kraPin: string;
  environment: string;
  /** Highest itemCd sequence KRA reports for this tin right now. */
  maxSeqFromKra: number;
  /** The counter's value before this run. */
  previousCounter: number;
  /** The counter's value after this run -- next allocation will be this + 1. */
  newCounter: number;
  itemsFromKra: number;
  /** Local catalog items backfilled to REGISTERED because KRA already has them. */
  reconciled: Array<{ itemId: string; itemCd: string }>;
}

/** itemCd's trailing 7 chars are always the sequence, by construction (see sync-items.usecase.ts). */
function parseItemCdSeq(itemCd: string): number | null {
  const tail = itemCd.slice(-7);
  const seq = parseInt(tail, 10);
  return Number.isNaN(seq) ? null : seq;
}

function isItemSearchPayload(
  value: unknown,
): value is { itemList: OscuItemSearchRow[] } {
  if (!value || typeof value !== 'object') return false;
  const list = (value as { itemList?: unknown }).itemList;
  return Array.isArray(list);
}

/**
 * Queries `/itemInfo` and returns KRA's real item list plus the highest
 * itemCd sequence any of them embeds -- the single source of truth for "what
 * seq does KRA actually expect next" (`maxSeq + 1`). Shared by
 * `resyncItemCdSequenceFromKra` (the on-demand full resync) and
 * `sync-items.usecase.ts`'s per-batch drift correction, so both always agree
 * with the same live answer instead of guessing independently.
 */
export async function fetchMaxItemCdSeqFromKra(
  connection: {
    kraPin: string;
    kraBhfId: string;
    cmcKey: string;
    environment: 'SANDBOX' | 'PRODUCTION';
    deviceId: string;
  },
  merchantId: string,
  etimsAdapter: IEtimsAdapter,
): Promise<{ maxSeq: number; rows: OscuItemSearchRow[] }> {
  const envelope = await etimsAdapter.getItemInfo(
    {
      tin: connection.kraPin,
      bhfId: connection.kraBhfId,
      cmcKey: connection.cmcKey,
      lastReqDt: EPOCH_LAST_REQ_DT,
    },
    {
      merchantId,
      branchId: connection.kraBhfId,
      kraPin: connection.kraPin,
      environment: connection.environment,
      cmcKey: connection.cmcKey,
      deviceId: connection.deviceId,
    },
  );

  if (!envelope.success) {
    throw new Error(envelope.error ?? 'Failed to fetch item list from OSCU');
  }

  const data = envelope.rawResponse?.['data'];
  const rows = isItemSearchPayload(data) ? data.itemList : [];

  let maxSeq = 0;
  for (const row of rows) {
    const seq = parseItemCdSeq(row.itemCd);
    if (seq != null && seq > maxSeq) {
      maxSeq = seq;
    }
  }

  return { maxSeq, rows };
}

/**
 * Recovers the true itemCd sequence for a tin directly from KRA instead of
 * guessing -- built after a shared-tin drift incident (2026-08-31, PIN
 * P600004185A) where the local counter fell behind what KRA had already
 * accepted (from a different database also submitting to the same shared
 * sandbox pin), and the bounded self-heal in sync-items.usecase.ts couldn't
 * close the gap fast enough. Queries `/itemInfo` (KRA Go-Live "LOOK UP
 * PRODUCT LIST", confirmed live 2026-08-31 with real data), takes the
 * highest sequence any item embeds, and sets the local counter to exactly
 * that -- KRA rejects any seq that isn't precisely last-accepted + 1 (no
 * gaps tolerated forward either, confirmed live 2026-08-31: nine consecutive
 * increasing values 508-516 were all rejected identically), so a local
 * counter that has drifted *ahead* of KRA (e.g. from repeated failed
 * self-heal retries each guessing forward) can never self-correct by
 * incrementing further -- only an authoritative overwrite from KRA's own
 * answer fixes it. This intentionally does NOT take Math.max(previous, kra):
 * previous is exactly the value that's wrong when this needs to run at all.
 *
 * Also backfills any local item KRA already has but this database doesn't
 * know about (registrationStatus stuck non-REGISTERED with no etimsItemCode)
 * -- exactly the "vehicle parts" case: it was already saveItem'd successfully
 * via some other database sharing this tin, so retrying it here only ever
 * collides with its own already-accepted registration. Matched on classification
 * + tax type + units + name (5 fields) rather than name alone, to keep this safe
 * even though ICatalogItemRepository.findByMerchantAndName is already merchant-scoped.
 */
export async function resyncItemCdSequenceFromKra(
  input: ResyncItemCdSequenceInput,
  deps: {
    itemRepo: ICatalogItemRepository;
    connectionRepo: IComplianceConnectionRepository;
    etimsAdapter: IEtimsAdapter;
    syncStateRepo: Repository<OscuSyncStateOrmEntity>;
  },
): Promise<ResyncItemCdSequenceResult> {
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

  const { maxSeq: maxSeqFromKra, rows } = await fetchMaxItemCdSeqFromKra(
    {
      kraPin: connection.kraPin,
      kraBhfId: connection.kraBhfId,
      cmcKey: connection.cmcKey,
      environment: connection.environment,
      deviceId: connection.deviceId,
    },
    input.merchantId,
    deps.etimsAdapter,
  );

  const syncKey = `item_cd_seq:${connection.kraPin}:${connection.environment}`;
  const existing = await deps.syncStateRepo.findOne({ where: { syncKey } });
  const previousCounter = existing?.lastReqDt
    ? parseInt(existing.lastReqDt, 10)
    : 0;
  const newCounter = maxSeqFromKra;
  if (newCounter !== previousCounter) {
    await deps.syncStateRepo.upsert(
      { syncKey, lastReqDt: String(newCounter) },
      ['syncKey'],
    );
  }

  const reconciled: ResyncItemCdSequenceResult['reconciled'] = [];
  const localItems = await deps.itemRepo.findByMerchant(input.merchantId);
  for (const row of rows) {
    const local = localItems.find(
      (item) =>
        item.registrationStatus !== 'REGISTERED' &&
        item.classificationCode === row.itemClsCd &&
        item.productTypeCode === row.itemTyCd &&
        item.packagingUnitCode === row.pkgUnitCd &&
        item.unitCode === row.qtyUnitCd &&
        item.name.trim().toLowerCase() === row.itemNm.trim().toLowerCase(),
    );
    if (!local) continue;

    const now = new Date();
    await deps.itemRepo.save({
      ...local,
      etimsItemCode: row.itemCd,
      registrationStatus: 'REGISTERED',
      lastSyncedAt: now,
      lastSyncAttemptAt: now,
      lastSyncResultCd: '000',
      lastSyncResultMsg:
        'Reconciled from KRA itemInfo -- already registered under this tin',
      updatedAt: now,
    });
    reconciled.push({ itemId: local.id, itemCd: row.itemCd });
  }

  return {
    kraPin: connection.kraPin,
    environment: connection.environment,
    maxSeqFromKra,
    previousCounter,
    newCounter,
    itemsFromKra: rows.length,
    reconciled,
  };
}
