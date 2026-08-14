import type { Repository } from 'typeorm';
import { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import { assertSubmissionAttemptsIncremented } from '../../domain/invariants/document-invariants';
import { assertValidTransition } from '../../domain/state-machine/compliance-state-machine';
import { EtimsPayloadBuilder } from '../../../regulatory/oscu/mapping/etims-payload.builder';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { ConnectionStatus } from '../../../shared/domain/enums/connection-status.enum';
import type { IEtimsAdapter } from '../../../regulatory/oscu/ports/etims-adapter.port';
import type {
  IComplianceConnectionRepository,
  IComplianceDocumentRepository,
  IComplianceEventRepository,
} from '../../../shared/ports/repository.port';
import { OscuSyncStateOrmEntity } from '../../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';

export interface SubmitDocumentResult {
  document: ComplianceDocument;
  success: boolean;
  receiptNumber?: string;
  error?: string;
}

/**
 * KRA validates OSCU `invcNo` is strictly incrementing per tin, starting at 1 --
 * same requirement as the itemCd sequence (see sync-items.usecase.ts). Persist the
 * last-issued value per (kraPin, environment) in `oscu_sync_state`.
 */
async function allocateInvoiceSequence(
  syncStateRepo: Repository<OscuSyncStateOrmEntity>,
  kraPin: string,
  environment: string,
): Promise<number> {
  const syncKey = `invoice_seq:${kraPin}:${environment}`;
  const existing = await syncStateRepo.findOne({ where: { syncKey } });
  const next = (existing?.lastReqDt ? parseInt(existing.lastReqDt, 10) : 0) + 1;
  await syncStateRepo.upsert({ syncKey, lastReqDt: String(next) }, ['syncKey']);
  return next;
}

/**
 * KRA only advances its own invcNo counter on ACCEPTED submissions, not rejected
 * ones (confirmed live 2026-08-11: after one accepted sale at invcNo 1, several
 * rejected credit note attempts at invcNo 2-4 each still expected "next: 2" on the
 * following try). Roll our local counter back on a permanent rejection so it stays
 * in sync -- but only if no one else has advanced past this value in the meantime.
 */
async function releaseInvoiceSequence(
  syncStateRepo: Repository<OscuSyncStateOrmEntity>,
  kraPin: string,
  environment: string,
  invcNo: number,
): Promise<void> {
  const syncKey = `invoice_seq:${kraPin}:${environment}`;
  const existing = await syncStateRepo.findOne({ where: { syncKey } });
  const current = existing?.lastReqDt ? parseInt(existing.lastReqDt, 10) : 0;
  if (current === invcNo) {
    await syncStateRepo.upsert({ syncKey, lastReqDt: String(invcNo - 1) }, [
      'syncKey',
    ]);
  }
}

/**
 * Submit document use case.
 * Transitions READY_FOR_SUBMISSION → SUBMITTED → ACCEPTED | REJECTED.
 */
export async function submitDocument(
  documentId: string,
  documentRepo: IComplianceDocumentRepository,
  connectionRepo: IComplianceConnectionRepository,
  eventRepo: IComplianceEventRepository,
  etimsAdapter: IEtimsAdapter,
  syncStateRepo: Repository<OscuSyncStateOrmEntity>,
): Promise<SubmitDocumentResult> {
  let document = await documentRepo.findById(documentId);
  if (!document) throw new Error(`Document ${documentId} not found`);

  const validForSubmit = [
    ComplianceStatus.READY_FOR_SUBMISSION,
    ComplianceStatus.RETRYING,
  ];
  if (!validForSubmit.includes(document.complianceStatus)) {
    throw new Error(
      `Document must be READY_FOR_SUBMISSION or RETRYING to submit. Current: ${document.complianceStatus}`,
    );
  }

  const connection = await connectionRepo.findByMerchantAndBranch(
    document.merchantId,
    document.branchId,
  );
  if (!connection) {
    throw new Error(
      `No compliance connection for merchant ${document.merchantId} branch ${document.branchId}`,
    );
  }

  if (connection.status !== ConnectionStatus.ACTIVE) {
    throw new Error(
      `Compliance connection is not ACTIVE (status: ${connection.status})`,
    );
  }
  if (!connection.kraBhfId) {
    throw new Error(
      `Branch ${document.branchId} has no KRA branch office id (kraBhfId) set`,
    );
  }

  if (document.oscuInvcNo == null) {
    const invcNo = await allocateInvoiceSequence(
      syncStateRepo,
      connection.kraPin,
      connection.environment,
    );
    document = await documentRepo.save({ ...document, oscuInvcNo: invcNo });
  }

  const payload = EtimsPayloadBuilder.buildFromDocument(document);
  payload.deviceId = connection.deviceId;

  // For CREDIT_NOTE: orgInvcNo must be the original sale's real allocated invcNo,
  // not anything parsed out of its human-readable documentNumber -- KRA rejects a
  // wrong value with "orgInvcNo does not exist" (confirmed live 2026-08-11).
  if (document.originalSaleId) {
    const original = await documentRepo.findById(document.originalSaleId);
    if (original?.oscuInvcNo != null) {
      payload.originalInvoiceSequence = original.oscuInvcNo;
    }
  }

  const result = await etimsAdapter.submitInvoice(payload, {
    merchantId: document.merchantId,
    branchId: connection.kraBhfId,
    kraPin: connection.kraPin,
    environment: connection.environment,
    cmcKey: connection.cmcKey,
    deviceId: connection.deviceId,
  });

  const prevAttempts = document.submissionAttempts;
  assertSubmissionAttemptsIncremented(prevAttempts, prevAttempts + 1);

  const submittedAt = new Date();

  // Transition to SUBMITTED first (audit: we sent the request)
  assertValidTransition(document.complianceStatus, ComplianceStatus.SUBMITTED);
  const submittedDoc: ComplianceDocument = {
    ...document,
    complianceStatus: ComplianceStatus.SUBMITTED,
    submissionAttempts: prevAttempts + 1,
    submittedAt,
  };
  await documentRepo.save(submittedDoc);
  await eventRepo.append({
    id: `evt-${documentId}-sub-${Date.now()}`,
    documentId,
    eventType: 'SUBMITTED',
    payloadSnapshot: payload as unknown as Record<string, unknown>,
    responseSnapshot: result.success
      ? { receiptNumber: result.receiptNumber }
      : { error: result.error },
    createdAt: submittedAt,
  });

  if (result.success && result.receiptNumber) {
    assertValidTransition(
      ComplianceStatus.SUBMITTED,
      ComplianceStatus.ACCEPTED,
    );
    const updated: ComplianceDocument = {
      ...submittedDoc,
      complianceStatus: ComplianceStatus.ACCEPTED,
      etimsReceiptNumber: result.receiptNumber,
    };
    await documentRepo.save(updated);
    await eventRepo.append({
      id: `evt-${documentId}-acc-${Date.now()}`,
      documentId,
      eventType: 'ACCEPTED',
      payloadSnapshot: null,
      responseSnapshot: result.rawResponse ?? {
        receiptNumber: result.receiptNumber,
      },
      createdAt: new Date(),
    });
    return {
      document: updated,
      success: true,
      receiptNumber: result.receiptNumber,
    };
  }

  const newStatus = result.error?.includes('retryable')
    ? ComplianceStatus.RETRYING
    : ComplianceStatus.REJECTED;
  assertValidTransition(ComplianceStatus.SUBMITTED, newStatus);

  // Permanent rejection: this invcNo was never accepted by KRA, so give it back
  // for the next document rather than leaving our counter ahead of KRA's.
  // (RETRYING keeps its invcNo -- the retry will reuse it, which is correct since
  // KRA hasn't accepted anything past it either.)
  if (newStatus === ComplianceStatus.REJECTED && document.oscuInvcNo != null) {
    await releaseInvoiceSequence(
      syncStateRepo,
      connection.kraPin,
      connection.environment,
      document.oscuInvcNo,
    );
  }

  const updated: ComplianceDocument = {
    ...submittedDoc,
    complianceStatus: newStatus,
  };
  await documentRepo.save(updated);
  await eventRepo.append({
    id: `evt-${documentId}-rej-${Date.now()}`,
    documentId,
    eventType: 'REJECTED',
    payloadSnapshot: null,
    responseSnapshot: { error: result.error, raw: result.rawResponse },
    createdAt: new Date(),
  });

  return { document: updated, success: false, error: result.error };
}
