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
 * Document statuses a bulk/single "retry" can act on. Mirrors the dashboard's
 * "Pending"/"Failed" rows (see `mapComplianceStatusToDigitax` in
 * `sales.service.ts`, which maps both REJECTED and FAILED to "failed").
 *
 * REJECTED and FAILED aren't submit-ready by themselves --
 * `submitDocument.usecase.ts` only accepts READY_FOR_SUBMISSION/RETRYING --
 * so this use case first walks them through the state machine's
 * REJECTED/FAILED -> RETRYING transition before calling submit, exactly like
 * a manual REJECTED -> RETRYING -> SUBMITTED retry would.
 */
export const RETRYABLE_SALE_STATUSES: ComplianceStatus[] = [
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

export async function retrySalesToEtims(
  input: RetrySalesInput,
  deps: {
    documentRepo: IComplianceDocumentRepository;
    connectionRepo: IComplianceConnectionRepository;
    eventRepo: IComplianceEventRepository;
    etimsAdapter: IEtimsAdapter;
    syncStateRepo: Repository<OscuSyncStateOrmEntity>;
  },
): Promise<RetrySalesResult> {
  const all = await deps.documentRepo.findByMerchant(input.merchantId);
  const picked = input.documentIds?.length
    ? all.filter((d) => input.documentIds!.includes(d.id))
    : all;

  const toRetry = picked.filter((d) =>
    RETRYABLE_SALE_STATUSES.includes(d.complianceStatus),
  );

  const results: RetrySaleResult[] = [];

  for (const doc of toRetry) {
    // Everything -- including the RETRYING hand-off -- stays inside the try
    // so one bad document (e.g. a missing connection) is recorded as a
    // per-document failure rather than aborting the whole batch, matching
    // sync-items.usecase.ts's per-item isolation.
    try {
      let current: ComplianceDocument = doc;

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
      }

      const outcome = await submitDocumentUseCase(
        current.id,
        deps.documentRepo,
        deps.connectionRepo,
        deps.eventRepo,
        deps.etimsAdapter,
        deps.syncStateRepo,
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

  return {
    merchantId: input.merchantId,
    attempted: results.length,
    succeeded,
    failed,
    results,
  };
}
