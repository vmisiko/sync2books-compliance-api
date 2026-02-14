import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { ComplianceDocument } from '../entities/compliance-document.entity';

/**
 * Invariants (must never break).
 * These are hard rules enforced throughout the system.
 */

/** A document cannot be ACCEPTED without having been SUBMITTED. */
export function invariantCannotAcceptWithoutSubmitted(
  status: ComplianceStatus,
): void {
  if (status === ComplianceStatus.ACCEPTED) {
    throw new Error('Invariant: ACCEPTED requires prior SUBMITTED state');
  }
}

/** A document cannot change lines after VALIDATED. */
export function invariantCannotChangeLinesAfterValidated(
  document: ComplianceDocument,
): void {
  if (
    document.complianceStatus !== ComplianceStatus.DRAFT &&
    document.complianceStatus !== ComplianceStatus.CANCELLED
  ) {
    throw new Error(
      'Invariant: Document lines cannot be modified after VALIDATED',
    );
  }
}

/** Historical invoices cannot be mutated. */
export function invariantHistoricalDocumentsImmutable(
  document: ComplianceDocument,
): void {
  const immutableStatuses: ComplianceStatus[] = [
    ComplianceStatus.SUBMITTED,
    ComplianceStatus.ACCEPTED,
    ComplianceStatus.REJECTED,
    ComplianceStatus.FAILED,
    ComplianceStatus.CANCELLED,
  ];
  if (immutableStatuses.includes(document.complianceStatus)) {
    throw new Error(
      `Invariant: Document in ${document.complianceStatus} state is immutable`,
    );
  }
}

/** Submission attempts must be counted. */
export function assertSubmissionAttemptsIncremented(
  before: number,
  after: number,
): void {
  if (after !== before + 1) {
    throw new Error(
      `Invariant: submissionAttempts must increment by 1 (was ${before}, got ${after})`,
    );
  }
}

/** All responses must be stored (enforced at infrastructure layer). */
export const INVARIANT_ALL_RESPONSES_STORED =
  'All OSCU/eTIMS responses must be persisted in ComplianceEvent';
