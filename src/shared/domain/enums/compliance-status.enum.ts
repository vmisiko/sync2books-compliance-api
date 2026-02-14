/**
 * Compliance document status - strictly enforced state machine.
 */
export enum ComplianceStatus {
  DRAFT = 'DRAFT',
  VALIDATED = 'VALIDATED',
  READY_FOR_SUBMISSION = 'READY_FOR_SUBMISSION',
  SUBMITTED = 'SUBMITTED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  RETRYING = 'RETRYING',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}
