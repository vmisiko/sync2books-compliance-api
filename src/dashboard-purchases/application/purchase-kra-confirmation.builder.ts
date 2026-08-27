import type { CatalogItem } from '../../catalog/domain/entities/catalog-item.entity';
import {
  OSCU_TAX_RATE_BY_TAX_TY_CD,
  round2,
  splitTaxInclusiveAmount,
} from '../../regulatory/oscu/mapping/oscu-tax-rates';

/** One entry from the raw KRA `getPurchaseTransactionInfo` `saleList[].itemList[]`. */
export type RawKraPurchaseItem = Record<string, unknown>;

export function extractRawItemList(
  rawKraResponse: Record<string, unknown> | null,
): RawKraPurchaseItem[] {
  const list = rawKraResponse?.itemList;
  return Array.isArray(list) ? (list as RawKraPurchaseItem[]) : [];
}

/** KRA-supplied name for a raw purchase line, used to correlate it to our own catalog. */
export function rawItemName(raw: RawKraPurchaseItem): string {
  const v = raw.itemNm ?? raw.spplrItemNm;
  return typeof v === 'string' ? v.trim() : '';
}

export type MatchedPurchaseItem = {
  raw: RawKraPurchaseItem;
  catalogItem: CatalogItem;
};

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function toStr(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

const TAX_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;
export type TaxLetter = (typeof TAX_LETTERS)[number];

/**
 * Prefers the seed record's own `taxTyCd` letter when present. Falls back to
 * matching its numeric `taxRt` against `OSCU_TAX_RATE_BY_TAX_TY_CD` -- seen
 * in practice (`upsertFromKraRecord` reads `item.taxRt`, not `taxTyCd`) even
 * though the OSCU spec sample for this endpoint shows a `taxTyCd` field.
 * Defaults to 'B' (16%, the standard rate) when neither is resolvable,
 * rather than throwing -- this only affects which bucket a line's tax lands
 * in for a confirmation call, not whether the item is allowed to be sent.
 */
export function resolveTaxLetter(raw: RawKraPurchaseItem): TaxLetter {
  const direct = toStr(raw.taxTyCd).toUpperCase();
  if ((TAX_LETTERS as readonly string[]).includes(direct)) {
    return direct as TaxLetter;
  }
  const rate = toNumber(raw.taxRt, NaN);
  if (Number.isFinite(rate)) {
    const match = TAX_LETTERS.find(
      (l) => OSCU_TAX_RATE_BY_TAX_TY_CD[l] === rate,
    );
    if (match) return match;
  }
  return 'B';
}

function formatKraDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * Builds the `sendPurchaseTransactionInfo` payload per OSCU spec, following
 * the confirmed-live gotchas in `oscu-payload-gotchas.md`: `splyAmt` is the
 * seed's own tax-inclusive total (never the seed's separately-reported
 * taxblAmt/taxAmt), and `taxblAmt`/`taxAmt` are re-derived from it via
 * `splitTaxInclusiveAmount` rather than copied verbatim. Each item's own
 * `itemCd`/`itemClsCd` come from OUR registered catalog match -- KRA
 * requires the purchased item to already exist under the buyer's own tin.
 */
export function buildPurchaseConfirmationPayload(params: {
  row: {
    spplrTin: string | null;
    spplrInvcNo: string | null;
    supplierName: string;
    invoiceDate: string;
    rawKraResponse: Record<string, unknown> | null;
  };
  matches: MatchedPurchaseItem[];
  invcNo: number;
  now: Date;
}): Record<string, unknown> {
  const { row, matches, invcNo, now } = params;

  const bucketTaxbl: Record<TaxLetter, number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    E: 0,
  };
  const bucketTax: Record<TaxLetter, number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    E: 0,
  };

  const itemList = matches.map(({ raw, catalogItem }, idx) => {
    const splyAmt = round2(toNumber(raw.totAmt ?? raw.splyAmt));
    const taxTyCd = resolveTaxLetter(raw);
    const { taxblAmt, taxAmt } = splitTaxInclusiveAmount(splyAmt, taxTyCd);
    bucketTaxbl[taxTyCd] = round2(bucketTaxbl[taxTyCd] + taxblAmt);
    bucketTax[taxTyCd] = round2(bucketTax[taxTyCd] + taxAmt);
    const qty = toNumber(raw.qty, 1);

    return {
      itemSeq: idx + 1,
      itemCd: catalogItem.etimsItemCode,
      itemClsCd: catalogItem.classificationCode,
      itemNm: catalogItem.name,
      bcd: null,
      spplrItemClsCd: toStr(raw.itemClsCd ?? raw.hsCd) || null,
      spplrItemCd: toStr(raw.itemCd) || null,
      spplrItemNm: rawItemName(raw) || null,
      pkgUnitCd: catalogItem.packagingUnitCode || 'NT',
      pkg: toNumber(raw.pkg, 1),
      qtyUnitCd: catalogItem.unitCode || 'NO',
      qty,
      prc: toNumber(raw.prc, qty ? splyAmt / qty : splyAmt),
      splyAmt,
      dcRt: 0,
      dcAmt: 0,
      taxblAmt,
      taxTyCd,
      taxAmt,
      totAmt: splyAmt,
      itemExprDt: null,
    };
  });

  const totTaxblAmt = round2(
    TAX_LETTERS.reduce((sum, l) => sum + bucketTaxbl[l], 0),
  );
  const totTaxAmt = round2(
    TAX_LETTERS.reduce((sum, l) => sum + bucketTax[l], 0),
  );
  const totAmt = round2(totTaxblAmt + totTaxAmt);

  const cfmDt = formatKraDateTime(now);
  const pchsDt = row.invoiceDate.replace(/-/g, '');
  const spplrBhfId = toStr(row.rawKraResponse?.spplrBhfId) || '00';
  const spplrInvcNoNum = row.spplrInvcNo ? toNumber(row.spplrInvcNo, NaN) : NaN;

  return {
    invcNo,
    orgInvcNo: 0,
    spplrTin: row.spplrTin,
    spplrBhfId,
    spplrNm: row.supplierName,
    spplrInvcNo: Number.isFinite(spplrInvcNoNum)
      ? spplrInvcNoNum
      : row.spplrInvcNo,
    regTyCd: 'M',
    pchsTyCd: 'N',
    rcptTyCd: 'P',
    pmtTyCd: '01',
    pchsSttsCd: '02',
    cfmDt,
    pchsDt,
    wrhsDt: null,
    cnclReqDt: null,
    cnclDt: null,
    rfdDt: null,
    totItemCnt: itemList.length,
    taxblAmtA: bucketTaxbl.A,
    taxblAmtB: bucketTaxbl.B,
    taxblAmtC: bucketTaxbl.C,
    taxblAmtD: bucketTaxbl.D,
    taxblAmtE: bucketTaxbl.E,
    taxRtA: OSCU_TAX_RATE_BY_TAX_TY_CD.A,
    taxRtB: OSCU_TAX_RATE_BY_TAX_TY_CD.B,
    taxRtC: OSCU_TAX_RATE_BY_TAX_TY_CD.C,
    taxRtD: OSCU_TAX_RATE_BY_TAX_TY_CD.D,
    taxRtE: OSCU_TAX_RATE_BY_TAX_TY_CD.E,
    taxAmtA: bucketTax.A,
    taxAmtB: bucketTax.B,
    taxAmtC: bucketTax.C,
    taxAmtD: bucketTax.D,
    taxAmtE: bucketTax.E,
    totTaxblAmt,
    totTaxAmt,
    totAmt,
    remark: null,
    regrId: 'sync2books',
    regrNm: 'sync2books',
    modrId: 'sync2books',
    modrNm: 'sync2books',
    itemList,
  };
}
