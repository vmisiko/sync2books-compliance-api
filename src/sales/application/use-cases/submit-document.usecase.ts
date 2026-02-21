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

export interface SubmitDocumentResult {
  document: ComplianceDocument;
  success: boolean;
  receiptNumber?: string;
  error?: string;
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
): Promise<SubmitDocumentResult> {
  const document = await documentRepo.findById(documentId);
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

  const payload = EtimsPayloadBuilder.buildFromDocument(document);
  payload.deviceId = connection.deviceId;

  const result = await etimsAdapter.submitInvoice(payload, {
    merchantId: document.merchantId,
    branchId: document.branchId,
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
