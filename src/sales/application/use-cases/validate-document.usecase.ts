import { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import { assertValidTransition } from '../../domain/state-machine/compliance-state-machine';
import type { ValidationResult } from '../../domain/value-objects/validation-result.vo';
import { runComplianceRules } from '../../domain/rules/compliance-rules.engine';
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

  const validation = runComplianceRules({ document, itemsById });

  if (!validation.isValid) {
    return { document, validation, transitioned: false };
  }

  assertValidTransition(ComplianceStatus.DRAFT, ComplianceStatus.VALIDATED);

  const updated: ComplianceDocument = {
    ...document,
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
