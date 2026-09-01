import { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import { assertValidTransition } from '../../domain/state-machine/compliance-state-machine';
import type { ValidationResult } from '../../domain/value-objects/validation-result.vo';
import { runComplianceRules } from '../../domain/rules/compliance-rules.engine';
import { deriveLineSnapshot } from '../../domain/utils/line-snapshot.util';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import type {
  IComplianceDocumentRepository,
  IComplianceEventRepository,
  IComplianceItemRepository,
} from '../../../shared/ports/repository.port';

export interface ValidateDocumentResult {
  document: ComplianceDocument;
  validation: ValidationResult;
  transitioned: boolean;
}

/**
 * Validate document use case.
 * Transitions DRAFT → VALIDATED if rules pass.
 */
export async function validateDocument(
  documentId: string,
  documentRepo: IComplianceDocumentRepository,
  itemRepo: IComplianceItemRepository,
  eventRepo: IComplianceEventRepository,
): Promise<ValidateDocumentResult> {
  const document = await documentRepo.findById(documentId);
  if (!document) throw new Error(`Document ${documentId} not found`);

  if (document.complianceStatus !== ComplianceStatus.DRAFT) {
    return {
      document,
      validation: {
        isValid: document.complianceStatus === ComplianceStatus.VALIDATED,
        errors: [],
        warnings: [],
      },
      transitioned: false,
    };
  }

  const itemIds = [...new Set(document.lines.map((l) => l.itemId))];
  const items = await itemRepo.findByIds(itemIds);
  const itemsById = new Map(items.map((i) => [i.id, i]));

  // Lines aren't frozen until VALIDATED (see ComplianceLine's doc comment),
  // so re-derive classification/unit snapshots from the current catalog
  // item on every DRAFT validation attempt -- otherwise a document created
  // before an item's codes were filled in stays permanently stuck re-using
  // its original empty snapshot, even after the item is fixed.
  const reDerivedDocument: ComplianceDocument = {
    ...document,
    lines: document.lines.map((l) => {
      const item = itemsById.get(l.itemId);
      return item ? { ...l, ...deriveLineSnapshot(l, item) } : l;
    }),
  };

  const validation = runComplianceRules({
    document: reDerivedDocument,
    itemsById,
  });

  if (!validation.isValid) {
    await documentRepo.save(reDerivedDocument);
    return { document: reDerivedDocument, validation, transitioned: false };
  }

  assertValidTransition(ComplianceStatus.DRAFT, ComplianceStatus.VALIDATED);

  const updated: ComplianceDocument = {
    ...reDerivedDocument,
    complianceStatus: ComplianceStatus.VALIDATED,
  };
  await documentRepo.save(updated);

  await eventRepo.append({
    id: `evt-${documentId}-${Date.now()}`,
    documentId,
    eventType: 'VALIDATED',
    payloadSnapshot: { validation },
    responseSnapshot: null,
    createdAt: new Date(),
  });

  return { document: updated, validation, transitioned: true };
}
