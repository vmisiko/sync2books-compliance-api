import type { Repository } from 'typeorm';
import type { IComplianceConnectionRepository } from '../../../shared/ports/repository.port';
import type { IEtimsAdapter } from '../../../regulatory/oscu/ports/etims-adapter.port';
import type { OscuSalesListRow } from '../../../regulatory/oscu/transport/endpoints/sales-list.dto';
import { OscuSyncStateOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';

/** KRA's own sample `lastReqDt` for a first-ever pull (OSCU spec §3.3.3.1 JSON SAMPLE). */
const EPOCH_LAST_REQ_DT = '20180523000000';

export interface ResyncInvoiceSequenceInput {
  merchantId: string;
  branchId: string;
}

export interface ResyncInvoiceSequenceResult {
  kraPin: string;
  environment: string;
  /** Highest invcNo KRA reports for this tin right now. */
  maxInvcNoFromKra: number;
  /** The counter's value before this run. */
  previousCounter: number;
  /** The counter's value after this run -- next allocation will be this + 1. */
  newCounter: number;
  salesFromKra: number;
}

function isSalesListPayload(
  value: unknown,
): value is { salesList: OscuSalesListRow[] } {
  if (!value || typeof value !== 'object') return false;
  const list = (value as { salesList?: unknown }).salesList;
  return Array.isArray(list);
}

/**
 * Recovers the true invcNo sequence for a tin directly from KRA instead of
 * guessing -- the invcNo counterpart to
 * catalog/resync-item-cd-sequence.usecase.ts, same shared-tin drift root
 * cause. Queries `/selectSalesTransactions` (confirmed live 2026-08-31 with
 * real sales + credit-note data), takes the highest invcNo any record
 * carries, and advances the local counter to match -- never backward.
 *
 * No item-level reconciliation here (unlike the itemCd resync) -- there's no
 * evidence yet of a local ComplianceDocument stuck unregistered while KRA
 * already has it, and matching sales documents reliably has no equivalent to
 * itemCd's classification+units+name composite key. Add it if that scenario
 * turns up.
 */
export async function resyncInvoiceSequenceFromKra(
  input: ResyncInvoiceSequenceInput,
  deps: {
    connectionRepo: IComplianceConnectionRepository;
    etimsAdapter: IEtimsAdapter;
    syncStateRepo: Repository<OscuSyncStateOrmEntity>;
  },
): Promise<ResyncInvoiceSequenceResult> {
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

  const envelope = await deps.etimsAdapter.selectSalesTransactions(
    {
      tin: connection.kraPin,
      bhfId: connection.kraBhfId,
      cmcKey: connection.cmcKey,
      lastReqDt: EPOCH_LAST_REQ_DT,
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
      envelope.error ?? 'Failed to fetch sales transaction list from OSCU',
    );
  }

  const data = envelope.rawResponse?.['data'];
  const rows = isSalesListPayload(data) ? data.salesList : [];

  let maxInvcNoFromKra = 0;
  for (const row of rows) {
    if (typeof row.invcNo === 'number' && row.invcNo > maxInvcNoFromKra) {
      maxInvcNoFromKra = row.invcNo;
    }
  }

  const syncKey = `invoice_seq:${connection.kraPin}:${connection.environment}`;
  const existing = await deps.syncStateRepo.findOne({ where: { syncKey } });
  const previousCounter = existing?.lastReqDt
    ? parseInt(existing.lastReqDt, 10)
    : 0;
  const newCounter = Math.max(previousCounter, maxInvcNoFromKra);
  if (newCounter !== previousCounter) {
    await deps.syncStateRepo.upsert(
      { syncKey, lastReqDt: String(newCounter) },
      ['syncKey'],
    );
  }

  return {
    kraPin: connection.kraPin,
    environment: connection.environment,
    maxInvcNoFromKra,
    previousCounter,
    newCounter,
    salesFromKra: rows.length,
  };
}
