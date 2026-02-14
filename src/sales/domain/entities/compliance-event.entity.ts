/**
 * Audit event - non-negotiable for KRA trust.
 * Full traceability and audit defensibility.
 */
export type ComplianceEventType =
  | 'DOCUMENT_CREATED'
  | 'VALIDATED'
  | 'VALIDATION_FAILED'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'RETRY_ATTEMPTED'
  | 'FAILED';

export interface ComplianceEvent {
  id: string;
  documentId: string;
  eventType: ComplianceEventType;
  payloadSnapshot: Record<string, unknown> | null;
  responseSnapshot: Record<string, unknown> | null;
  createdAt: Date;
}
