import { ComplianceDocument } from '../entities/compliance-document.entity';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import type {
  ComplianceError,
  ComplianceWarning,
  ValidationResult,
} from '../value-objects/validation-result.vo';

/**
 * Structural rules - document shape and arithmetic.
 */
export function runStructuralRules(
  document: ComplianceDocument,
): ValidationResult {
  const errors: ComplianceError[] = [];
  const warnings: ComplianceWarning[] = [];

  if (document.documentType === DocumentType.CREDIT_NOTE) {
    if (!document.originalDocumentNumber?.trim()) {
      errors.push({
        code: 'STRUCTURAL_CREDIT_NOTE_MISSING_ORIGINAL_DOCUMENT',
        message:
          'Credit note must include originalDocumentNumber (original trader invoice number)',
        field: 'originalDocumentNumber',
      });
    }
  }

  // Must have at least 1 line
  if (!document.lines || document.lines.length === 0) {
    errors.push({
      code: 'STRUCTURAL_NO_LINES',
      message: 'Document must have at least 1 line',
      field: 'lines',
    });
  }

  if (document.lines && document.lines.length > 0) {
    const tolerance = 0.01;

    // Subtotal = sum(line subtotals)
    const computedSubtotal = document.lines.reduce(
      (sum, line) => sum + line.quantity * line.unitPrice,
      0,
    );
    if (Math.abs(computedSubtotal - document.subtotalAmount) > tolerance) {
      errors.push({
        code: 'STRUCTURAL_SUBTOTAL_MISMATCH',
        message: `Document subtotal (${document.subtotalAmount}) does not match sum of line totals (${computedSubtotal.toFixed(2)})`,
        field: 'subtotalAmount',
      });
    }

    // Tax = sum(line tax)
    const computedTax = document.lines.reduce(
      (sum, line) => sum + line.taxAmount,
      0,
    );
    if (Math.abs(computedTax - document.totalTax) > tolerance) {
      errors.push({
        code: 'STRUCTURAL_TAX_MISMATCH',
        message: `Document totalTax (${document.totalTax}) does not match sum of line tax amounts (${computedTax.toFixed(2)})`,
        field: 'totalTax',
      });
    }

    // Total = subtotal + tax
    const computedTotal = computedSubtotal + computedTax;
    if (Math.abs(computedTotal - document.totalAmount) > tolerance) {
      errors.push({
        code: 'STRUCTURAL_TOTAL_MISMATCH',
        message: `Document total (${document.totalAmount}) does not match subtotal + tax (${computedTotal.toFixed(2)})`,
        field: 'totalAmount',
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
