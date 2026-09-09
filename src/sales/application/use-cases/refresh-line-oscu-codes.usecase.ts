import { Logger } from '@nestjs/common';
import { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { resolveLineOscuCodes } from '../../domain/utils/line-oscu-codes.util';
import type { ComplianceItem } from '../../../shared/domain/entities/compliance-item.entity';
import type {
  IComplianceDocumentRepository,
  IComplianceItemRepository,
} from '../../../shared/ports/repository.port';

const logger = new Logger('RefreshLineOscuCodes');

/**
 * Re-points a not-yet-accepted document's lines at their catalog items'
 * CURRENT eTIMS codes.
 *
 * prepare-document already does this on the way to READY_FOR_SUBMISSION, but
 * two retry paths never pass through prepare: REJECTED/FAILED hand straight
 * over to RETRYING, and a document already sitting in
 * READY_FOR_SUBMISSION/RETRYING goes straight to submit. Those are exactly
 * the documents most likely to be holding an orphaned itemCd -- a rejection
 * for "Item <code> does not exist in your stock master" is what sends a
 * document to REJECTED in the first place, and re-registering the item to
 * fix it is precisely what issues the new code the document doesn't have.
 * Without this, every retry resends the dead code and the sale can never be
 * filed. See resolveLineOscuCodes for why the item wins over the snapshot.
 *
 * Refuses to touch an ACCEPTED document: its snapshots are the audit record
 * of what was actually filed with KRA and are immutable.
 */
export async function refreshLineOscuCodes(
  documentId: string,
  documentRepo: IComplianceDocumentRepository,
  itemRepo: IComplianceItemRepository,
): Promise<{ document: ComplianceDocument; refreshedLines: number }> {
  const document = await documentRepo.findById(documentId);
  if (!document) throw new Error(`Document ${documentId} not found`);

  if (document.complianceStatus === ComplianceStatus.ACCEPTED) {
    return { document, refreshedLines: 0 };
  }

  const itemIds = [...new Set(document.lines.map((l) => l.itemId))];
  const items: ComplianceItem[] = await itemRepo.findByIds(itemIds);
  const itemsById = new Map(items.map((i) => [i.id, i]));

  let refreshedLines = 0;
  const lines = document.lines.map((l) => {
    const item = itemsById.get(l.itemId);
    // Deliberately non-throwing, unlike prepare-document: this runs as a
    // best-effort touch-up in front of submit, so an unresolvable line is
    // left exactly as it was for submit's own error handling to report.
    if (!item) return l;

    const resolution = resolveLineOscuCodes(l, item);
    if (resolution.status !== 'SUPERSEDED') return l;

    refreshedLines += 1;
    logger.log(
      `document=${documentId} line=${l.id} item=${l.itemId} itemCd ` +
        `${l.etimsItemCodeSnapshot} -> ${resolution.itemCd} ` +
        `(item re-registered under a new code; refreshing before submit)`,
    );
    return { ...l, ...resolution.codes };
  });

  if (refreshedLines === 0) return { document, refreshedLines: 0 };

  const updated = await documentRepo.save({ ...document, lines });
  return { document: updated, refreshedLines };
}
