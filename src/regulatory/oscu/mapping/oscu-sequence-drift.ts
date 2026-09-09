/**
 * Reading KRA's expected-value hints out of OSCU rejection messages.
 *
 * Four counters in `oscu_sync_state` are local mirrors of counters KRA owns:
 * the itemCd sequence, `sarNo`, sales `invcNo`, and purchases' own separate
 * `invcNo`. All four drift for the same reason -- a KRA PIN is shared across
 * databases, so another system consumes values this one never sees -- and all
 * four are repaired the same way, by overwriting the local value with KRA's
 * rather than incrementing toward it. A counter that has drifted *ahead* can
 * never converge by incrementing further.
 *
 * They split into two families by whether the rejection names the value KRA
 * wants:
 *
 * - **itemCd does not.** It masks the expected sequence behind asterisks
 *   (`"Expected sequence ending with: ********1"`), so repairing it costs an
 *   `/itemInfo` probe -- see `fetchMaxItemCdSeqFromKra`. It has no parser here
 *   precisely because there is nothing parseable.
 * - **sarNo and invcNo do.** Both state the expected value outright, so they
 *   are repaired inline from the error string with no extra round trip. That is
 *   what the parsers below are for.
 *
 * Each parser doubles as its own classifier: a non-null return *is* the "this
 * was a drift rejection" signal, so callers need no separate predicate. They
 * are deliberately strict about shape for that reason -- a loose regex here
 * would misclassify a neighbouring counter's rejection and correct the wrong
 * number. All message shapes below were captured live against the KRA sandbox
 * (PIN P600004185A) on the dates noted.
 */

/**
 * `insertStockIO` sarNo drift, e.g.
 * `"Invalid sarNo: Expected: 10 but found: 15"` (live 2026-09-09).
 */
export function parseExpectedSarNo(
  message: string | null | undefined,
): number | null {
  if (!message) return null;
  const m =
    /invalid\s+sarno\s*:\s*expected\s*:\s*(\d+)\s*but\s*found\s*:\s*(\d+)/i.exec(
      message,
    );
  return m ? toPositiveInt(m[1]) : null;
}

/**
 * `invcNo` drift on either sales (`sendSalesTransaction`) or purchases
 * (`sendPurchaseTransactionInfo`), e.g.
 * `"Invc No: 8 is invalid, use the expected value: 9"` (live 2026-09-09 on
 * sales; the purchases endpoint carries its own independent counter and is
 * assumed to reject in the same shape, not yet confirmed live).
 */
export function parseExpectedInvcNo(
  message: string | null | undefined,
): number | null {
  if (!message) return null;
  const m = /invc\s*no\b[\s\S]*?expected\s+value\s*:?\s*(\d+)/i.exec(message);
  return m ? toPositiveInt(m[1]) : null;
}

function toPositiveInt(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
