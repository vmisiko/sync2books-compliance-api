import type { ComplianceItem } from '../../../shared/domain/entities/compliance-item.entity';
import { ComplianceDocument } from '../entities/compliance-document.entity';
import type { ValidationResult } from '../value-objects/validation-result.vo';
import { runClassificationRules } from './classification-rule.engine';
import { runPinRules } from './pin-rule.engine';
import { runStructuralRules } from './structural-rule.engine';
import { runTaxRules } from './tax-rule.engine';

/**
 * Compliance rules engine - validates before submission.
 * Rules must be declarative.
 * Only VALIDATED documents move forward.
 */
export interface ComplianceRulesEngineInput {
  document: ComplianceDocument;
  itemsById: Map<string, ComplianceItem>;
}

export function runComplianceRules(
  input: ComplianceRulesEngineInput,
): ValidationResult {
  const { document, itemsById } = input;

  const results: ValidationResult[] = [
    runStructuralRules(document),
    runTaxRules(document.lines),
    runClassificationRules(document.lines, itemsById),
    runPinRules({ customerPin: document.customerPin }),
  ];

  const allErrors = results.flatMap((r) => r.errors);
  const allWarnings = results.flatMap((r) => r.warnings);

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}
