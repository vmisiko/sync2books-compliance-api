import type {
  ComplianceError,
  ComplianceWarning,
  ValidationResult,
} from '../value-objects/validation-result.vo';

/** KRA PIN format: P (company) or A (individual), 9 digits, then a checksum letter */
const KRA_PIN_PATTERN = /^[PA]\d{9}[A-Z]$/;

export type PinValidationContext = {
  customerPin: string | null;
  isB2B?: boolean;
};

/**
 * PIN rules - B2B vs B2C, malformed rejection.
 * If customerPin present → mark B2B. If missing → B2C. If malformed → reject.
 */
export function runPinRules(context: PinValidationContext): ValidationResult {
  const errors: ComplianceError[] = [];
  const warnings: ComplianceWarning[] = [];

  const { customerPin } = context;

  if (customerPin === null || customerPin === undefined || customerPin === '') {
    return { isValid: true, errors: [], warnings: [] };
  }

  const trimmed = customerPin.trim();
  if (trimmed === '') {
    return { isValid: true, errors: [], warnings: [] };
  }

  if (!KRA_PIN_PATTERN.test(trimmed)) {
    errors.push({
      code: 'PIN_MALFORMED',
      message:
        'customerPin must match KRA format: P or A, 9 digits, then a checksum letter',
      field: 'customerPin',
    });
  }

  return { isValid: errors.length === 0, errors, warnings };
}
