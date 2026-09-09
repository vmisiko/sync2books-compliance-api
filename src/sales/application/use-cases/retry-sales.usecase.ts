import { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { canTransition } from '../../domain/state-machine/compliance-state-machine';
import { submitDocument as submitDocumentUseCase } from './submit-document.usecase';
import type {
  IComplianceConnectionRepository,
  IComplianceDocumentRepository,
  IComplianceEventRepository,
} from '../../../shared/ports/repository.port';
import type { IEtimsAdapter } from '../../../regulatory/oscu/ports/etims-adapter.port';
import { OscuSyncStateOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';

/**
 * Document statuses a bulk/single "retry" can act on. This set must stay a
 * superset of every internal status the dashboard renders with an actionable
 * button, which is what `mapComplianceStatusToDigitax` in `sales.service.ts`
 * decides: it collapses REJECTED/FAILED into "failed", and DRAFT, VALIDATED
 * *and* READY_FOR_SUBMISSION all into "ready_to_submit".
 *
 * DRAFT and VALIDATED were missing here, and that was a silent dead end --
 * confirmed live 2026-09-07. The dashboard offered "Submit to KRA" on a DRAFT
 * sale (because it reads "ready_to_submit"), this filter dropped it, and
 * `POST /dashboard-api/sales/sync` answered `200 {attempted: 0, results: []}`:
 * no submission, no error, no log line, nothing for the detail panel to show.
 *
 * None of these are submit-ready by themselves -- `submit-document.usecase.ts`
 * only accepts READY_FOR_SUBMISSION/RETRYING -- so this use case walks each
 * one forward to that point first, always through the real state machine,
 * never by jumping states:
 *   - DRAFT      -> applyInventory -> validate -> prepare -> submit
 *   - VALIDATED  -> prepare -> submit
 *   - REJECTED / FAILED -> RETRYING -> submit
 *   - READY_FOR_SUBMISSION / RETRYING -> submit
 */
export const RETRYABLE_SALE_STATUSES: ComplianceStatus[] = [
  ComplianceStatus.DRAFT,
  ComplianceStatus.VALIDATED,
  ComplianceStatus.READY_FOR_SUBMISSION,
  ComplianceStatus.RETRYING,
  ComplianceStatus.REJECTED,
  ComplianceStatus.FAILED,
];

export interface RetrySalesInput {
  merchantId: string;
  /**
   * Document ids to retry. Omit (or send an empty array) to retry every
   * document in a retryable status for the tenant.
   */
  documentIds?: string[];
}

export type RetrySaleResult = {
  documentId: string;
  documentNumber: string;
  success: boolean;
  status: ComplianceStatus;
  receiptNumber: string | null;
  error: string | null;
};

export interface RetrySalesResult {
  merchantId: string;
  attempted: number;
  succeeded: number;
  failed: number;
  results: RetrySaleResult[];
}

const logger = new Logger('RetrySalesToEtims');

export async function retrySalesToEtims(
  input: RetrySalesInput,
  deps: {
    documentRepo: IComplianceDocumentRepository;
    connectionRepo: IComplianceConnectionRepository;
    eventRepo: IComplianceEventRepository;
    etimsAdapter: IEtimsAdapter;
    syncStateRepo: Repository<OscuSyncStateOrmEntity>;
    /**
     * The DRAFT -> VALIDATED -> READY_FOR_SUBMISSION half of the pipeline,
     * passed in rather than re-implemented so a retry and an original submit
     * take literally the same path. `applyInventoryMovements` is re-run safe
     * (see SalesService.applyInventoryMovements) -- a DRAFT document reaching
     * here has usually already had its movements recorded by the attempt that
     * left it in DRAFT, and must not be decremented twice.
     */
    applyInventoryMovements: (documentId: string) => Promise<void>;
    validateDocument: (
      documentId: string,
    ) => Promise<{ validation: { isValid: boolean; errors: unknown[] } }>;
    prepareDocument: (documentId: string) => Promise<unknown>;
    /**
     * Re-points lines at their items' current eTIMS codes immediately before
     * submit. Needed because the REJECTED/FAILED -> RETRYING and the
     * already-READY_FOR_SUBMISSION/RETRYING paths below never pass through
     * `prepareDocument`, which is the only other place that does this -- see
     * refresh-line-oscu-codes.usecase.ts.
     */
    refreshLineOscuCodes: (documentId: string) => Promise<unknown>;
  },
): Promise<RetrySalesResult> {
  const all = await deps.documentRepo.findByMerchant(input.merchantId);
  const requestedIds = input.documentIds?.length ? input.documentIds : null;
  const picked = requestedIds
    ? all.filter((d) => requestedIds.includes(d.id))
    : all;

  const toRetry = picked.filter((d) =>
    RETRYABLE_SALE_STATUSES.includes(d.complianceStatus),
  );

  logger.log(
    `retry merchant=${input.merchantId} requested=${
      requestedIds ? requestedIds.join(',') : 'ALL'
    } merchantDocuments=${all.length} matched=${picked.length} retryable=${toRetry.length}`,
  );

  const results: RetrySaleResult[] = [];

  // An explicitly requested document that this endpoint won't act on has to
  // say so. Silently omitting it is what produced the unexplained
  // `{attempted: 0, results: []}` -- the caller asked about a specific sale
  // and got an answer that looked like success.
  if (requestedIds) {
    const byId = new Map(all.map((d) => [d.id, d]));
    for (const id of requestedIds) {
      const doc = byId.get(id);
      if (!doc) {
        logger.warn(
          `retry merchant=${input.merchantId} document=${id} not found for this merchant`,
        );
        results.push({
          documentId: id,
          documentNumber: '',
          success: false,
          status: ComplianceStatus.DRAFT,
          receiptNumber: null,
          error: `Document ${id} was not found for merchant ${input.merchantId}`,
        });
        continue;
      }
      if (!RETRYABLE_SALE_STATUSES.includes(doc.complianceStatus)) {
        logger.warn(
          `retry merchant=${input.merchantId} document=${id} status=${doc.complianceStatus} not retryable`,
        );
        results.push({
          documentId: doc.id,
          documentNumber: doc.documentNumber,
          success: false,
          status: doc.complianceStatus,
          receiptNumber: null,
          error: `Document ${doc.documentNumber} is ${doc.complianceStatus} — nothing to submit. Retryable statuses: ${RETRYABLE_SALE_STATUSES.join(', ')}`,
        });
      }
    }
  }

  for (const doc of toRetry) {
    // Everything -- including the RETRYING hand-off -- stays inside the try
    // so one bad document (e.g. a missing connection) is recorded as a
    // per-document failure rather than aborting the whole batch, matching
    // sync-items.usecase.ts's per-item isolation.
    try {
      let current: ComplianceDocument = doc;
      logger.log(
        `retry document=${current.id} number=${current.documentNumber} status=${current.complianceStatus} branch=${current.branchId} -- starting`,
      );

      if (current.complianceStatus === ComplianceStatus.DRAFT) {
        await deps.applyInventoryMovements(current.id);
        const validation = await deps.validateDocument(current.id);
        if (!validation.validation.isValid) {
          throw new Error(
            `Sale validation failed: ${JSON.stringify(validation.validation.errors)}`,
          );
        }
        logger.log(`retry document=${current.id} DRAFT -> VALIDATED`);
        current = await refresh(deps.documentRepo, current.id);
      }

      if (current.complianceStatus === ComplianceStatus.VALIDATED) {
        await deps.prepareDocument(current.id);
        logger.log(
          `retry document=${current.id} VALIDATED -> READY_FOR_SUBMISSION`,
        );
        current = await refresh(deps.documentRepo, current.id);
      }

      if (
        current.complianceStatus === ComplianceStatus.REJECTED ||
        current.complianceStatus === ComplianceStatus.FAILED
      ) {
        if (
          !canTransition(current.complianceStatus, ComplianceStatus.RETRYING)
        ) {
          throw new Error(
            `Document ${current.id} cannot transition from ${current.complianceStatus} to RETRYING`,
          );
        }
        current = await deps.documentRepo.save({
          ...current,
          complianceStatus: ComplianceStatus.RETRYING,
        });
        logger.log(`retry document=${current.id} -> RETRYING`);
      }

      // Last thing before submit, so it covers every path into this loop --
      // including the two that skipped prepareDocument entirely. A no-op for
      // documents whose lines already hold their item's current itemCd.
      await deps.refreshLineOscuCodes(current.id);

      const outcome = await submitDocumentUseCase(
        current.id,
        deps.documentRepo,
        deps.connectionRepo,
        deps.eventRepo,
        deps.etimsAdapter,
        deps.syncStateRepo,
      );

      logger.log(
        `retry document=${doc.id} finished success=${outcome.success} status=${outcome.document.complianceStatus} receipt=${outcome.receiptNumber ?? '-'}${
          outcome.error ? ` error=${outcome.error}` : ''
        }`,
      );

      results.push({
        documentId: doc.id,
        documentNumber: doc.documentNumber,
        success: outcome.success,
        status: outcome.document.complianceStatus,
        receiptNumber: outcome.receiptNumber ?? null,
        error: outcome.error ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        `retry document=${doc.id} number=${doc.documentNumber} threw: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      results.push({
        documentId: doc.id,
        documentNumber: doc.documentNumber,
        success: false,
        status: doc.complianceStatus,
        receiptNumber: null,
        error: message,
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  logger.log(
    `retry merchant=${input.merchantId} done attempted=${results.length} succeeded=${succeeded} failed=${failed}`,
  );

  return {
    merchantId: input.merchantId,
    attempted: results.length,
    succeeded,
    failed,
    results,
  };
}

/**
 * Re-reads a document after a use case advanced its status. Those use cases
 * persist through the repository and return their own shapes, so the in-memory
 * copy this loop holds is stale the moment one of them runs -- and acting on a
 * stale status is exactly how a document ends up skipping a state.
 */
async function refresh(
  documentRepo: IComplianceDocumentRepository,
  documentId: string,
): Promise<ComplianceDocument> {
  const document = await documentRepo.findById(documentId);
  if (!document) throw new Error(`Document ${documentId} not found`);
  return document;
}
