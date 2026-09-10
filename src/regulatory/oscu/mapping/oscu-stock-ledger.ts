/**
 * Deriving an item's net quantity from KRA's own Stock IO ledger
 * (`selectStockMoveList`).
 *
 * This exists because of an asymmetry in what KRA tells us. `saveStockMaster`
 * refuses an `rsdQty` that disagrees with the running total of that item's
 * Stock IO ledger, but its rejection comes in two wordings and only one names
 * the numbers (see `isRsdQtyLedgerMismatch`). When it doesn't, the gap has to
 * be measured rather than read -- and this is the measurement.
 *
 * The reason it can fail, and must be allowed to: the documented `StockMoveRes`
 * field table does not list `sarTyCd` on the returned movements, and without it
 * a movement's direction is unknowable, so a total cannot be formed. A guessed
 * total here would be written straight into `rsdQty`, which is a tax filing.
 * So this returns an explicit `unsignable` instead of a number it can't stand
 * behind, and the caller is expected to stop and ask a human for the figure
 * rather than proceed.
 *
 * Field names are matched leniently (`itemList` or `stockItemList`, numeric or
 * string quantities) because the real response shape has never been captured
 * from live KRA -- only the spec's PDF table. Leniency here is about tolerating
 * an unknown-but-valid shape, never about inventing a value: anything that
 * doesn't parse is reported as such.
 */

/** OSCU code classification 12 (Stock In/Out): 01-06 incoming, 11-16 outgoing. */
function directionOf(sarTyCd: string): 1 | -1 | null {
  if (/^0[1-6]$/.test(sarTyCd)) return 1;
  if (/^1[1-6]$/.test(sarTyCd)) return -1;
  return null;
}

export type KraLedgerQty =
  | { status: 'ok'; qty: number; movements: number }
  /** KRA has no Stock IO history for this item at all -- a net of zero. */
  | { status: 'empty' }
  /** The response parsed, but a movement's direction could not be determined. */
  | { status: 'unsignable'; reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  // sarNo is a NUMBER in StockMoveRes while itemCd/sarTyCd are CHAR, and this
  // is used across all three -- coerce rather than silently reading a real
  // sarNo as absent.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function itemsOf(
  move: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const list = move['itemList'] ?? move['stockItemList'];
  if (!Array.isArray(list)) return [];
  return list
    .map(asRecord)
    .filter((r): r is Record<string, unknown> => r !== null);
}

/**
 * Nets one item's movements out of a `selectStockMoveList` response.
 *
 * `raw` is the adapter's `rawResponse` for that call; only `data.stockMoveList`
 * is read. Movements that mention other items are ignored, not counted as
 * zero -- a tenant's ledger covers the whole catalog.
 */
export function deriveKraLedgerQty(raw: unknown, itemCd: string): KraLedgerQty {
  const data = asRecord(asRecord(raw)?.['data']);
  const list = data?.['stockMoveList'];
  if (!Array.isArray(list)) {
    return {
      status: 'unsignable',
      reason: 'KRA returned no stockMoveList to read',
    };
  }

  let qty = 0;
  let movements = 0;

  for (const entry of list) {
    const move = asRecord(entry);
    if (!move) continue;

    const lines = itemsOf(move).filter(
      (line) => asString(line['itemCd']) === itemCd,
    );
    if (lines.length === 0) continue;

    const direction = directionOf(asString(move['sarTyCd']));
    if (direction === null) {
      // Deliberately fails the whole derivation rather than skipping this one
      // movement: a partial total is indistinguishable from a correct one at
      // the call site, and would be just as wrong.
      return {
        status: 'unsignable',
        reason:
          `a movement for ${itemCd} (sarNo ${asString(move['sarNo']) || '?'}) ` +
          `carries no recognisable sarTyCd, so its direction — stock in or ` +
          `stock out — cannot be determined`,
      };
    }

    for (const line of lines) {
      const lineQty = asNumber(line['qty']);
      if (lineQty === null) {
        return {
          status: 'unsignable',
          reason: `a movement line for ${itemCd} has no readable qty`,
        };
      }
      qty += direction * Math.abs(lineQty);
      movements += 1;
    }
  }

  if (movements === 0) return { status: 'empty' };
  return { status: 'ok', qty, movements };
}
