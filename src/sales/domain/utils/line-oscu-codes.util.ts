import { deriveLineSnapshot } from './line-snapshot.util';
import type { ComplianceItem } from '../../../shared/domain/entities/compliance-item.entity';
import type { ComplianceLine } from '../entities/compliance-line.entity';

export type LineOscuCodes = Pick<
  ComplianceLine,
  | 'etimsItemCodeSnapshot'
  | 'classificationCodeSnapshot'
  | 'unitCodeSnapshot'
  | 'packagingUnitCodeSnapshot'
  | 'taxTyCdSnapshot'
  | 'productTypeCodeSnapshot'
>;

export type LineOscuCodeResolution =
  /** Neither the line nor the catalog item has an itemCd -- not submittable. */
  | { status: 'UNREGISTERED' }
  /** The line's snapshot is blank; adopt the item's code, keep its other overrides. */
  | { status: 'FILL'; itemCd: string }
  /** The line's code is already the item's current one -- nothing to do. */
  | { status: 'UNCHANGED'; itemCd: string }
  /** The line holds an orphaned code; the whole OSCU code set is re-derived. */
  | { status: 'SUPERSEDED'; itemCd: string; codes: LineOscuCodes };

/**
 * Resolves the OSCU code set a line will actually be submitted with, from the
 * line's own snapshots plus the catalog item's current registration.
 *
 * The catalog item's CURRENT etimsItemCode wins over the line's snapshot, not
 * the other way round. itemCd is not a stable identifier -- it encodes
 * itemTyCd/pkgUnitCd/qtyUnitCd (see sync-items.usecase.ts's
 * generateEtimsItemCd), so re-registering an item under a corrected product
 * type or unit issues it a brand-new code and permanently orphans the old
 * one. A line still holding the old code submits an itemCd KRA has no record
 * of, and KRA rejects the whole invoice with "Invalid Item: Item <old code>
 * (itemSeq N) does not exist in your stock master" -- confirmed live
 * 2026-09-09 on a QuickBooks item reclassified from Finished Product ('2',
 * KE2CTNO0000009) to Service ('3', KE3CTNO0000019). Preferring the snapshot
 * made that permanent: every retry resent the dead code.
 *
 * On SUPERSEDED the rest of the code set is re-derived from the item too,
 * not just itemCd: classification/unit/packaging/taxTyCd/productTypeCd all
 * describe the very registration itemCd identifies, so keeping the line's
 * stale values would pair a Service itemCd with the Goods packaging and
 * product type it was previously registered under -- the same class of
 * mismatch KRA rejects. Every other status leaves per-line overrides alone
 * (create-document allows callers to set them deliberately).
 *
 * This does not weaken the "snapshots freeze after VALIDATED" audit rule.
 * That rule exists to freeze what was actually FILED with KRA, and both
 * callers run strictly before a document is accepted -- prepare-document
 * (VALIDATED -> READY_FOR_SUBMISSION) and the retry pipeline's pre-submit
 * refresh. Freezing a code KRA never accepted preserves nothing; it only
 * guarantees the document can never be filed.
 */
export function resolveLineOscuCodes(
  line: ComplianceLine,
  item: ComplianceItem,
): LineOscuCodeResolution {
  const currentItemCd = nonEmpty(item.etimsItemCode);
  const snapshotItemCd = nonEmpty(line.etimsItemCodeSnapshot);

  // Falls back to the snapshot when the item has no current code at all: an
  // item mid-resync (etimsItemCode cleared by a permanent saveItem
  // rejection) must not blank out a code the line already holds.
  const itemCd = currentItemCd ?? snapshotItemCd;
  if (!itemCd) return { status: 'UNREGISTERED' };

  if (snapshotItemCd === null) return { status: 'FILL', itemCd };
  if (itemCd === snapshotItemCd) return { status: 'UNCHANGED', itemCd };

  return {
    status: 'SUPERSEDED',
    itemCd,
    codes: {
      etimsItemCodeSnapshot: itemCd,
      ...deriveLineSnapshot(
        { classificationCodeSnapshot: null, unitCodeSnapshot: null },
        item,
      ),
      packagingUnitCodeSnapshot: item.packagingUnitCode,
      taxTyCdSnapshot: item.taxTyCd,
      productTypeCodeSnapshot: item.productTypeCode,
    },
  };
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
