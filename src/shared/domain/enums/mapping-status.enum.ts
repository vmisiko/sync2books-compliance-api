/**
 * Lifecycle status for a tax/unit/classification mapping row, as surfaced by
 * the Mapping Center dashboard (filter pills: All / Mapped / Needs Review /
 * Unmapped). Drives the `active` flag on the underlying row:
 *   - MAPPED / REVISED  -> active: true  (this row is live in KRA resolution)
 *   - NEEDS_REVIEW / UNMAPPED -> active: false (candidate only, invisible to
 *     ClassificationResolverTypeOrm and the tax/unit resolution paths until a
 *     human approves it)
 */
export enum MappingStatus {
  /** Approved and currently in effect (either by a human, or a pre-existing global default). */
  MAPPED = 'MAPPED',
  /** An auto-suggested candidate mapping awaiting human approval. */
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  /** A pulled external value with no confident auto-suggestion available. */
  UNMAPPED = 'UNMAPPED',
  /** Was MAPPED, then edited by a human after initial approval. */
  REVISED = 'REVISED',
}
