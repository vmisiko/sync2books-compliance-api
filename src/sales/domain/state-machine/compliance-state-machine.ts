import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';

/**
 * Strictly enforced state machine.
 * No implicit state jumps allowed.
 */
export type StateTransition =
  | { from: ComplianceStatus.DRAFT; to: ComplianceStatus.VALIDATED }
  | {
      from: ComplianceStatus.VALIDATED;
      to: ComplianceStatus.READY_FOR_SUBMISSION;
    }
  | {
      from: ComplianceStatus.READY_FOR_SUBMISSION;
      to: ComplianceStatus.SUBMITTED;
    }
  | { from: ComplianceStatus.SUBMITTED; to: ComplianceStatus.ACCEPTED }
  | { from: ComplianceStatus.SUBMITTED; to: ComplianceStatus.REJECTED }
  | { from: ComplianceStatus.SUBMITTED; to: ComplianceStatus.RETRYING }
  | { from: ComplianceStatus.REJECTED; to: ComplianceStatus.RETRYING }
  | { from: ComplianceStatus.RETRYING; to: ComplianceStatus.SUBMITTED }
  | { from: ComplianceStatus.DRAFT; to: ComplianceStatus.CANCELLED }
  | { from: ComplianceStatus.REJECTED; to: ComplianceStatus.FAILED }
  | { from: ComplianceStatus.SUBMITTED; to: ComplianceStatus.FAILED };

const VALID_TRANSITIONS: Map<ComplianceStatus, ComplianceStatus[]> = new Map([
  [
    ComplianceStatus.DRAFT,
    [ComplianceStatus.VALIDATED, ComplianceStatus.CANCELLED],
  ],
  [ComplianceStatus.VALIDATED, [ComplianceStatus.READY_FOR_SUBMISSION]],
  [ComplianceStatus.READY_FOR_SUBMISSION, [ComplianceStatus.SUBMITTED]],
  [
    ComplianceStatus.SUBMITTED,
    [
      ComplianceStatus.ACCEPTED,
      ComplianceStatus.REJECTED,
      ComplianceStatus.RETRYING,
      ComplianceStatus.FAILED,
    ],
  ],
  [ComplianceStatus.ACCEPTED, []],
  [
    ComplianceStatus.REJECTED,
    [ComplianceStatus.RETRYING, ComplianceStatus.FAILED],
  ],
  [ComplianceStatus.RETRYING, [ComplianceStatus.SUBMITTED]],
  [ComplianceStatus.FAILED, []],
  [ComplianceStatus.CANCELLED, []],
]);

export function canTransition(
  from: ComplianceStatus,
  to: ComplianceStatus,
): boolean {
  const allowed = VALID_TRANSITIONS.get(from) ?? [];
  return allowed.includes(to);
}

export function assertValidTransition(
  from: ComplianceStatus,
  to: ComplianceStatus,
): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid state transition: ${from} → ${to}. Allowed from ${from}: [${(
        VALID_TRANSITIONS.get(from) ?? []
      ).join(', ')}]`,
    );
  }
}
