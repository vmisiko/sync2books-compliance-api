import type { SaleCallback } from '../../domain/sale-callback';

export interface ISaleCallbackStore {
  findByDocumentId(documentId: string): Promise<SaleCallback | null>;
  save(callback: SaleCallback): Promise<SaleCallback>;
  /**
   * Take the right to deliver `outcomeKey` for this document: succeeds only if
   * it is still pending and due, and pushes `nextAttemptAt` to `leaseUntil` so
   * a second worker (the sweep, another instance) skips it meanwhile.
   */
  claim(
    documentId: string,
    outcomeKey: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<boolean>;
  /** Pending deliveries whose next attempt is due, oldest first. */
  findDue(now: Date, limit: number): Promise<SaleCallback[]>;
}
