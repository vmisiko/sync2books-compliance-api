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
 * One more rejection in this file is not a counter at all: `saveStockMaster`'s
 * `rsdQty` mismatch. It is here because it is read and repaired the same way --
 * KRA names both the value it expects and the value we sent -- and because it
 * is the far end of the same chain: a `sarNo` that never lands leaves the Stock
 * IO ledger empty, and an empty ledger is what makes `rsdQty` disagree.
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

/**
 * Classifies a `saveStockMaster` rejection as "your rsdQty disagrees with the
 * Stock IO ledger", across BOTH wordings KRA uses for it:
 *
 * - `"rsdQty mismatch. Expected: 0.0 but found: 150"` (live 2026-09-09) --
 *   names both numbers, so the gap is repairable straight from the message.
 * - `"rsdQty quantity provided does not match the KE2BFBL0000051 code from
 *   Stock IO"` (live 2026-09-10) -- names neither. Same condition, but the
 *   size of the gap has to come from somewhere else.
 *
 * Splitting the classifier from {@link parseRsdQtyMismatch} is the point:
 * every other parser in this file doubles as its own classifier because a
 * parsed value and a recognised rejection are the same thing there. Here they
 * are not, and conflating them is exactly why the second wording fell through
 * to a bare failure -- the condition was recognisable, the numbers were not.
 * This mirrors the itemCd/sarNo split at the top of the file: some rejections
 * tell you the answer, some only tell you the question.
 */
export function isRsdQtyLedgerMismatch(
  message: string | null | undefined,
): boolean {
  if (!message) return false;
  if (/rsdqty\s+mismatch/i.test(message)) return true;
  // "rsdQty quantity provided does not match the <itemCd> code from Stock IO"
  return /rsdqty[\s\S]{0,60}?does\s+not\s+match[\s\S]{0,60}?stock\s*io/i.test(
    message,
  );
}

/**
 * The numeric form of {@link isRsdQtyLedgerMismatch}, for the wording that
 * names both values.
 *
 * Unlike the counters above, `expected` here is not a value to overwrite a
 * local mirror with -- it is KRA's running total from the Stock IO ledger, and
 * `found` is the quantity we just declared. The gap between them is exactly
 * the ledger movement that never reached KRA, which is what makes this
 * repairable: send `found - expected` as an `insertStockIO` and the two agree.
 *
 * Returns null for the wording that names neither number -- check
 * {@link isRsdQtyLedgerMismatch} first if you need to know *whether* this is a
 * ledger mismatch, rather than by how much.
 *
 * Quantities, so unlike the counters: fractional, and `expected` is very
 * often 0 (an item whose ledger is empty because every movement it ever had
 * was skipped for want of a unit price). Both are therefore accepted as any
 * finite number rather than a positive integer.
 */
export function parseRsdQtyMismatch(
  message: string | null | undefined,
): { expected: number; found: number } | null {
  if (!message) return null;
  const m =
    /rsdqty\s+mismatch[\s\S]{0,40}?expected\s*:?\s*(-?\d+(?:\.\d+)?)[\s\S]{0,20}?found\s*:?\s*(-?\d+(?:\.\d+)?)/i.exec(
      message,
    );
  if (!m) return null;
  const expected = Number.parseFloat(m[1]);
  const found = Number.parseFloat(m[2]);
  if (!Number.isFinite(expected) || !Number.isFinite(found)) return null;
  return { expected, found };
}

function toPositiveInt(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
