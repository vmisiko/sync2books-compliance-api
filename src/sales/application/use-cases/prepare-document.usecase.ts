import { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import { assertValidTransition as _assertValidTransition } from '../../domain/state-machine/compliance-state-machine';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import type { ComplianceItem } from '../../../shared/domain/entities/compliance-item.entity';
import type {
  IComplianceDocumentRepository,
  IComplianceEventRepository,
  IComplianceItemRepository,
} from '../../../shared/ports/repository.port';

export interface PrepareDocumentResult {
  document: ComplianceDocument;
}

export async function prepareDocument(
  documentId: string,
  documentRepo: IComplianceDocumentRepository,
  itemRepo: IComplianceItemRepository,
  eventRepo: IComplianceEventRepository,
): Promise<PrepareDocumentResult> {
  const document: ComplianceDocument | null =
    await documentRepo.findById(documentId);
  if (!document) throw new Error(`Document ${documentId} not found`);

  if (document.complianceStatus !== ComplianceStatus.VALIDATED) {
    throw new Error(
      `Document must be VALIDATED to prepare. Current: ${document.complianceStatus}`,
    );
  }

  // Enrich line snapshots from registered catalog items (OSCU-ready codes).
  const itemIds = [...new Set(document.lines.map((l) => l.itemId))];
  const items: ComplianceItem[] = await itemRepo.findByIds(itemIds);
  const itemsById = new Map<string, ComplianceItem>();
  for (const item of items) {
    itemsById.set(item.id, item);
  }

  const enrichedLines: ComplianceDocument['lines'] = document.lines.map((l) => {
    const item = itemsById.get(l.itemId);
    if (!item) {
      throw new Error(`Item ${l.itemId} not found while preparing document`);
    }

    const packagingUnitCodeSnapshot: string =
      l.packagingUnitCodeSnapshot ?? item.packagingUnitCode;

    const taxTyCdSnapshot: string = l.taxTyCdSnapshot ?? item.taxTyCd;

    const productTypeCodeSnapshot: string =
      l.productTypeCodeSnapshot ?? item.productTypeCode;

    return {
      ...l,
      classificationCodeSnapshot:
        l.classificationCodeSnapshot?.trim() !== ''
          ? l.classificationCodeSnapshot
          : item.classificationCode,
      unitCodeSnapshot:
        l.unitCodeSnapshot?.trim() !== '' ? l.unitCodeSnapshot : item.unitCode,
      packagingUnitCodeSnapshot,
      taxTyCdSnapshot,
      productTypeCodeSnapshot,
    };
  });

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
    lines: enrichedLines,
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
