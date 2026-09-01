import type { ComplianceItem } from '../../../shared/domain/entities/compliance-item.entity';
import type { ComplianceLine } from '../entities/compliance-line.entity';

/**
 * Falls back to the catalog item's current classification/unit codes when a
 * line has no explicit override. A line override only counts if it's a
 * non-empty string -- undefined/null/"" must fall through to the item, so
 * always check truthiness before calling `.trim()` (a bare `?.trim() !== ''`
 * check is wrong: `undefined?.trim()` is `undefined`, and `undefined !== ''`
 * is true, which keeps the missing value instead of falling back).
 */
export function deriveLineSnapshot(
  line: {
    classificationCodeSnapshot?: string | null;
    unitCodeSnapshot?: string | null;
  },
  item: Pick<ComplianceItem, 'classificationCode' | 'unitCode'>,
): Pick<ComplianceLine, 'classificationCodeSnapshot' | 'unitCodeSnapshot'> {
  return {
    classificationCodeSnapshot:
      line.classificationCodeSnapshot && line.classificationCodeSnapshot.trim() !== ''
        ? line.classificationCodeSnapshot
        : item.classificationCode,
    unitCodeSnapshot:
      line.unitCodeSnapshot && line.unitCodeSnapshot.trim() !== ''
        ? line.unitCodeSnapshot
        : item.unitCode,
  };
}
