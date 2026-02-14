import { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import { assertValidTransition as _assertValidTransition } from '../../domain/state-machine/compliance-state-machine';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import type {
  IComplianceDocumentRepository,
  IComplianceEventRepository,
} from '../../../shared/ports/repository.port';

export interface PrepareDocumentResult {
  document: ComplianceDocument;
}

export async function prepareDocument(
  documentId: string,
  documentRepo: IComplianceDocumentRepository,
  eventRepo: IComplianceEventRepository,
): Promise<PrepareDocumentResult> {
  // Legacy repositories return the shared (legacy) ComplianceDocument shape.
  // In Step 1 we keep repos as-is, but treat the value as our Sales document model.
  const document = (await documentRepo.findById(
    documentId,
  )) as unknown as ComplianceDocument | null;
  if (!document) throw new Error(`Document ${documentId} not found`);

  if (document.complianceStatus !== ComplianceStatus.VALIDATED) {
    throw new Error(
      `Document must be VALIDATED to prepare. Current: ${document.complianceStatus}`,
    );
  }

  const assertValidTransition: (
    from: ComplianceStatus,
    to: ComplianceStatus,
  ) => void = _assertValidTransition;

  assertValidTransition(
    ComplianceStatus.VALIDATED,
    ComplianceStatus.READY_FOR_SUBMISSION,
  );

  const updated: ComplianceDocument = {
    ...document,
    complianceStatus: ComplianceStatus.READY_FOR_SUBMISSION,
  };
  await documentRepo.save(updated);

  await eventRepo.append({
    id: `evt-${documentId}-ready-${Date.now()}`,
    documentId,
    eventType: 'VALIDATED',
    payloadSnapshot: { prepared: true },
    responseSnapshot: null,
    createdAt: new Date(),
  });

  return { document: updated };
}
