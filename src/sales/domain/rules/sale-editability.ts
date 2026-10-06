import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';
import type { ComplianceDocument } from '../entities/compliance-document.entity';

/**
 * Statuses that are still pre-submission ("Ready to Submit" in the dashboard):
 * nothing has been sent to KRA yet, so the document is still ours to correct.
 * SUBMITTED/ACCEPTED/REJECTED/RETRYING/FAILED/CANCELLED are deliberately absent --
 * once a document has been (or is being) fiscalised it is immutable.
 */
export const EDITABLE_SALE_STATUSES: ReadonlySet<ComplianceStatus> = new Set([
  ComplianceStatus.DRAFT,
  ComplianceStatus.VALIDATED,
  ComplianceStatus.READY_FOR_SUBMISSION,
]);

export type SaleEditability = { editable: true } | { editable: false; reason: string };

/**
 * Whether a sale's header details (customer, payment, date) may still be edited.
 *
 * - Only a SALE: credit notes reference an already-fiscalised original and are
 *   created in one step, so they are never edited.
 * - Only a manually-entered sale (SourceSystem.MANUAL, no sourceInvoiceId): an
 *   ERP-sourced sale's source of truth is the ERP invoice, so a local edit would
 *   be silently overwritten by (or diverge from) the next pull. Fix it in the ERP.
 * - Only while pre-submission and with no KRA footprint (no submittedAt and no
 *   reserved oscuInvcNo / receipt number).
 */
export function getSaleEditability(
  document: Pick<
    ComplianceDocument,
    | 'documentType'
    | 'complianceStatus'
    | 'sourceSystem'
    | 'sourceInvoiceId'
    | 'submittedAt'
    | 'oscuInvcNo'
    | 'etimsReceiptNumber'
  >,
): SaleEditability {
  if (document.documentType !== DocumentType.SALE) {
    return { editable: false, reason: 'Only sales can be edited, not credit notes' };
  }
  if (document.sourceSystem !== SourceSystem.MANUAL || document.sourceInvoiceId) {
    return {
      editable: false,
      reason:
        'This sale came from an ERP invoice -- correct it in the source system and re-pull it',
    };
  }
  if (!EDITABLE_SALE_STATUSES.has(document.complianceStatus)) {
    return {
      editable: false,
      reason: `A sale in status ${document.complianceStatus} has already been submitted to KRA and can no longer be edited`,
    };
  }
  if (document.submittedAt || document.oscuInvcNo || document.etimsReceiptNumber) {
    return {
      editable: false,
      reason: 'This sale already has a KRA submission footprint and can no longer be edited',
    };
  }
  return { editable: true };
}
