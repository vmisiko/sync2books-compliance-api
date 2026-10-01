/**
 * A sale's result callback: the URL a `/v1` caller asked us to POST the eTIMS
 * outcome to, and how delivery of the latest outcome went.
 *
 * One record per document. A document can reach more than one outcome (KRA
 * rejects it, the caller fixes the item and retries, KRA accepts it), and each
 * new outcome replaces the previous delivery state -- the caller cares whether
 * they have been told the *current* result.
 */

export type SaleCallbackStatus =
  /** Registered; the sale has not reached a result yet. */
  | 'awaiting_outcome'
  /** A result is waiting to be delivered, or is between retries. */
  | 'pending'
  /** The caller's endpoint answered 2xx for the latest result. */
  | 'delivered'
  /** Every retry for the latest result failed. */
  | 'failed';

export type SaleCallbackEvent = 'sale.completed' | 'sale.failed';

export interface SaleCallback {
  documentId: string;
  merchantId: string;
  url: string;
  status: SaleCallbackStatus;
  event: SaleCallbackEvent | null;
  /**
   * Identifies the outcome being delivered (`<status>:<submissionAttempts>`),
   * so the same outcome announced twice is delivered once, and a receiver can
   * de-duplicate on the `X-Callback-Id` header built from it.
   */
  outcomeKey: string | null;
  payload: Record<string, unknown> | null;
  attempts: number;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  lastResponseStatus: number | null;
  lastError: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Wait before retry N (1-based) after a failed attempt. Seven attempts over
 * roughly ten and a half hours, then the delivery is marked failed and can be
 * re-sent by hand.
 */
export const CALLBACK_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
];

export const MAX_CALLBACK_ATTEMPTS = CALLBACK_RETRY_DELAYS_MS.length + 1;

/** When to try again after `attempts` failures, or null when out of attempts. */
export function nextCallbackAttemptAt(
  attempts: number,
  now: Date,
): Date | null {
  if (attempts >= MAX_CALLBACK_ATTEMPTS) return null;
  return new Date(now.getTime() + CALLBACK_RETRY_DELAYS_MS[attempts - 1]);
}

/** The public view returned on `GET /v1/sales/:id`. */
export function toV1Callback(callback: SaleCallback | null) {
  if (!callback) return null;
  return {
    url: callback.url,
    status: callback.status,
    event: callback.event,
    attempts: callback.attempts,
    lastAttemptAt: callback.lastAttemptAt?.toISOString() ?? null,
    lastResponseStatus: callback.lastResponseStatus,
    lastError: callback.lastError,
    deliveredAt: callback.deliveredAt?.toISOString() ?? null,
    nextAttemptAt:
      callback.status === 'pending'
        ? (callback.nextAttemptAt?.toISOString() ?? null)
        : null,
  };
}
