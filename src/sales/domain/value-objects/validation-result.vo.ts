/**
 * Rules engine output.
 * Only VALIDATED documents move forward.
 */
export interface ComplianceError {
  code: string;
  message: string;
  field?: string;
}

export interface ComplianceWarning {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ComplianceError[];
  warnings: ComplianceWarning[];
}
