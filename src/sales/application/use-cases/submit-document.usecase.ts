import { Logger } from '@nestjs/common';
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
 * KRA names the invcNo it expects directly in the rejection, e.g.
 * "Invc No: 8 is invalid, use the expected value: 9" (confirmed live 2026-09-09,
 * sandbox PIN P600004185A). Same property as the sarNo rejection, and the same
 * consequence: the counter can be repaired inline with no probe call, unlike the
 * itemCd sequence whose rejection masks the expected value behind asterisks and
 * therefore costs an /itemInfo round trip (see fetchMaxItemCdSeqFromKra).
 * Returns the expected value, or null when this isn't an invcNo drift rejection.
 */
export function parseExpectedInvcNo(
  message: string | null | undefined,
): number | null {
  if (!message) return null;
  const m = /invc\s*no\b[\s\S]*?expected\s+value\s*:?\s*(\d+)/i.exec(message);
  if (!m) return null;
  const expected = Number.parseInt(m[1], 10);
  return Number.isSafeInteger(expected) && expected > 0 ? expected : null;
}

/**
 * Overwrites the counter so `invcNo` reads as the latest issued value. Used only
 * by the drift correction, which then submits that same value rather than
 * re-allocating -- nothing can slip in between the write and the send.
 *
 * Unconditional, not a Math.max: when this runs, the local value is precisely
 * the one KRA has just told us is wrong, so preserving it is never right. Same
 * reasoning as resyncItemCdSequenceFromKra's refusal to take a max.
 */
async function forceInvoiceSequence(
  syncStateRepo: Repository<OscuSyncStateOrmEntity>,
  kraPin: string,
  environment: string,
  invcNo: number,
): Promise<void> {
  const syncKey = `invoice_seq:${kraPin}:${environment}`;
  await syncStateRepo.upsert({ syncKey, lastReqDt: String(invcNo) }, [
    'syncKey',
  ]);
}

/**
 * Submit document use case.
 * Transitions READY_FOR_SUBMISSION → SUBMITTED → ACCEPTED | REJECTED.
 */
const logger = new Logger('SubmitDocument');

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

  // Everything from here to the adapter call is a place a submission can die
  // without KRA ever being contacted. Each of these used to throw into
  // retry-sales.usecase.ts's per-document catch and vanish into a JSON field
  // nobody rendered -- log the decision points so the service's own logs say
  // how far a submission actually got.
  const connection = await connectionRepo.findByMerchantAndBranch(
    document.merchantId,
    document.branchId,
  );
  if (!connection) {
    logger.error(
      `document=${documentId} number=${document.documentNumber} -- no compliance connection for merchant=${document.merchantId} branch=${document.branchId}`,
    );
    throw new Error(
      `No compliance connection for merchant ${document.merchantId} branch ${document.branchId}`,
    );
  }

  if (connection.status !== ConnectionStatus.ACTIVE) {
    logger.error(
      `document=${documentId} -- connection ${connection.id} status=${connection.status}, not ACTIVE`,
    );
    throw new Error(
      `Compliance connection is not ACTIVE (status: ${connection.status})`,
    );
  }
  if (!connection.kraBhfId) {
    logger.error(
      `document=${documentId} -- branch ${document.branchId} has no kraBhfId`,
    );
    throw new Error(
      `Branch ${document.branchId} has no KRA branch office id (kraBhfId) set`,
    );
  }

  // cmcKey is deliberately absent: it's an OSCU secret, and this line is the
  // one most likely to be pasted into a ticket.
  logger.log(
    `document=${documentId} number=${document.documentNumber} status=${document.complianceStatus} -- connection resolved kraPin=${connection.kraPin} bhfId=${connection.kraBhfId} deviceId=${connection.deviceId} env=${connection.environment}`,
  );

  if (document.oscuInvcNo == null) {
    const invcNo = await allocateInvoiceSequence(
      syncStateRepo,
      connection.kraPin,
      connection.environment,
    );
    document = await documentRepo.save({ ...document, oscuInvcNo: invcNo });
    logger.log(`document=${documentId} allocated oscuInvcNo=${invcNo}`);
  } else {
    logger.log(
      `document=${documentId} reusing oscuInvcNo=${document.oscuInvcNo}`,
    );
  }

  // Rebuilt rather than mutated after a drift correction: oscuInvcNo is carried
  // on the document itself, so the payload has to be regenerated from the
  // corrected document instead of patched in place.
  const buildPayload = async (doc: ComplianceDocument) => {
    const p = EtimsPayloadBuilder.buildFromDocument(doc);
    p.deviceId = connection.deviceId;

    // For CREDIT_NOTE: orgInvcNo must be the original sale's real allocated invcNo,
    // not anything parsed out of its human-readable documentNumber -- KRA rejects a
    // wrong value with "orgInvcNo does not exist" (confirmed live 2026-08-11).
    if (doc.originalSaleId) {
      const original = await documentRepo.findById(doc.originalSaleId);
      if (original?.oscuInvcNo != null) {
        p.originalInvoiceSequence = original.oscuInvcNo;
      }
    }
    return p;
  };

  const connectionContext = {
    merchantId: document.merchantId,
    branchId: connection.kraBhfId,
    kraPin: connection.kraPin,
    environment: connection.environment,
    cmcKey: connection.cmcKey,
    deviceId: connection.deviceId,
  };

  let payload = await buildPayload(document);
  logger.log(
    `document=${documentId} invcNo=${document.oscuInvcNo} -- submitting to eTIMS`,
  );
  let result = await etimsAdapter.submitInvoice(payload, connectionContext);
  logger.log(
    `document=${documentId} -- eTIMS replied success=${result.success} receipt=${result.receiptNumber ?? '-'}${
      result.error ? ` error=${result.error}` : ''
    }`,
  );

  // One correction, then fall through to the normal rejection handling. The
  // counter drifts because the KRA PIN is shared across databases, so another
  // system consumes invcNos this one never sees -- the same root cause as the
  // itemCd and sarNo sequences, and equally unfixable by a local counter alone.
  //
  // `expected !== document.oscuInvcNo` guards the degenerate case where KRA
  // echoes back the value we already sent: retrying that would be identical and
  // pointless. Both the counter and the document are corrected, because a later
  // retry of this same document reuses its persisted oscuInvcNo.
  if (!result.success) {
    const expected = parseExpectedInvcNo(result.error ?? null);
    if (expected !== null && expected !== document.oscuInvcNo) {
      logger.warn(
        `document=${documentId} invcNo drift: sent=${document.oscuInvcNo} ` +
          `expected=${expected} -- correcting counter and retrying once`,
      );
      await forceInvoiceSequence(
        syncStateRepo,
        connection.kraPin,
        connection.environment,
        expected,
      );
      document = await documentRepo.save({
        ...document,
        oscuInvcNo: expected,
      });
      payload = await buildPayload(document);
      result = await etimsAdapter.submitInvoice(payload, connectionContext);
      logger.log(
        `document=${documentId} -- eTIMS replied on retry success=${result.success} ` +
          `receipt=${result.receiptNumber ?? '-'}${result.error ? ` error=${result.error}` : ''}`,
      );
    }
  }

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
