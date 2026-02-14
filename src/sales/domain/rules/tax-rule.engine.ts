import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import { ComplianceLine } from '../entities/compliance-line.entity';
import type {
  ComplianceError,
  ComplianceWarning,
  ValidationResult,
} from '../value-objects/validation-result.vo';

/** Kenya VAT standard rate (regulation-isolated - can be configurable) */
const VAT_STANDARD_RATE = 0.16;

/**
 * Tax rules - VAT_STANDARD, VAT_ZERO, EXEMPT.
 */
export function runTaxRules(lines: ComplianceLine[]): ValidationResult {
  const errors: ComplianceError[] = [];
  const warnings: ComplianceWarning[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineRef = `lines[${i}]`;

    switch (line.taxCategory) {
      case TaxCategory.VAT_STANDARD: {
        const expectedTax = line.quantity * line.unitPrice * VAT_STANDARD_RATE;
        const tolerance = 0.01;
        if (Math.abs(line.taxAmount - expectedTax) > tolerance) {
          errors.push({
            code: 'TAX_VAT_STANDARD_RATE',
            message: `VAT_STANDARD must use 16% rate. Expected tax: ${expectedTax.toFixed(2)}, got: ${line.taxAmount}`,
            field: `${lineRef}.taxAmount`,
          });
        }
        break;
      }

      case TaxCategory.VAT_ZERO:
        if (line.taxAmount > 0) {
          errors.push({
            code: 'TAX_VAT_ZERO_NON_ZERO',
            message: 'VAT_ZERO cannot have tax amount > 0',
            field: `${lineRef}.taxAmount`,
          });
        }
        break;

      case TaxCategory.EXEMPT:
        if (line.taxAmount !== 0) {
          errors.push({
            code: 'TAX_EXEMPT_HAS_TAX',
            message: 'EXEMPT must not calculate VAT',
            field: `${lineRef}.taxAmount`,
          });
        }
        break;

      case TaxCategory.OTHER:
        break;
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}
