import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import type { ComplianceItem } from '../../../shared/domain/entities/compliance-item.entity';
import { ComplianceLine } from '../entities/compliance-line.entity';
import type {
  ComplianceError,
  ComplianceWarning,
  ValidationResult,
} from '../value-objects/validation-result.vo';

/** Valid classification code pattern (e.g. HS codes for goods) */
const VALID_CLASSIFICATION_PATTERN = /^[A-Z0-9]{4,12}$/;

/** Service classification prefix */
const SERVICE_CLASSIFICATION_PREFIX = 'SVC';

/**
 * Classification rules - GOODS, SERVICE, Export.
 *
 * Note: We only need `itemType` at validation time; the line snapshots must be stored.
 */
export function runClassificationRules(
  lines: ComplianceLine[],
  itemsById: Map<string, ComplianceItem>,
): ValidationResult {
  const errors: ComplianceError[] = [];
  const warnings: ComplianceWarning[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const item = itemsById.get(line.itemId);
    const lineRef = `lines[${i}]`;

    if (!item) {
      errors.push({
        code: 'CLASSIFICATION_ITEM_NOT_FOUND',
        message: `Item ${line.itemId} not found for line`,
        field: `${lineRef}.itemId`,
      });
      continue;
    }

    if (item.itemType === ItemType.GOODS) {
      if (!VALID_CLASSIFICATION_PATTERN.test(line.classificationCodeSnapshot)) {
        errors.push({
          code: 'CLASSIFICATION_GOODS_INVALID',
          message: `GOODS must have valid HS classification code (4-12 alphanumeric). Got: ${line.classificationCodeSnapshot}`,
          field: `${lineRef}.classificationCodeSnapshot`,
        });
      }
    }

    if (item.itemType === ItemType.SERVICE) {
      if (
        !line.classificationCodeSnapshot.startsWith(
          SERVICE_CLASSIFICATION_PREFIX,
        )
      ) {
        warnings.push({
          code: 'CLASSIFICATION_SERVICE_PREFIX',
          message: `SERVICE items typically use classification starting with ${SERVICE_CLASSIFICATION_PREFIX}`,
          field: `${lineRef}.classificationCodeSnapshot`,
        });
      }
    }

    if (!line.unitCodeSnapshot || line.unitCodeSnapshot.trim() === '') {
      errors.push({
        code: 'CLASSIFICATION_UNIT_REQUIRED',
        message: 'Unit code is required',
        field: `${lineRef}.unitCodeSnapshot`,
      });
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}
