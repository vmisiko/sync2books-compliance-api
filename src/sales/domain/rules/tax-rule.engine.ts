import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import { ComplianceLine } from '../entities/compliance-line.entity';
import type {
  ComplianceError,
  ComplianceWarning,
  ValidationResult,
} from '../value-objects/validation-result.vo';

/** Kenya VAT standard rate (regulation-isolated - can be configurable) */
const VAT_STANDARD_RATE = 0.16;
/** Kenya VAT 8% rate (petroleum products, KRA taxTyCd 'E') */
const VAT_EIGHT_RATE = 0.08;

/**
 * The rate this engine's own validation rules below expect per taxCategory —
 * exported so callers building a sale's lines (e.g. from a pulled invoice
 * whose source ERP doesn't carry a reliable per-line tax amount, like
 * QuickBooks which only totals tax at the invoice header) can compute a
 * taxAmount that is guaranteed to pass `runTaxRules` rather than guessing.
 */
export function expectedTaxAmount(
  taxCategory: TaxCategory,
  quantity: number,
  unitPrice: number,
): number {
  switch (taxCategory) {
    case TaxCategory.VAT_STANDARD:
      return quantity * unitPrice * VAT_STANDARD_RATE;
    case TaxCategory.VAT_8:
      return quantity * unitPrice * VAT_EIGHT_RATE;
    default:
      return 0;
  }
}

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

      case TaxCategory.VAT_8: {
        const expectedTax = line.quantity * line.unitPrice * VAT_EIGHT_RATE;
        const tolerance = 0.01;
        if (Math.abs(line.taxAmount - expectedTax) > tolerance) {
          errors.push({
            code: 'TAX_VAT_8_RATE',
            message: `VAT_8 must use 8% rate. Expected tax: ${expectedTax.toFixed(2)}, got: ${line.taxAmount}`,
            field: `${lineRef}.taxAmount`,
          });
        }
        break;
      }

      case TaxCategory.OTHER:
        break;
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}
