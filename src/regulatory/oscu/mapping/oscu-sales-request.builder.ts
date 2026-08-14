import type { EtimsInvoicePayload } from './etims-payload.types';
import type { OscuTrnsSalesSaveWrReq } from '../transport/endpoints/trns-sales-save.dto';
import {
  OSCU_TAX_RATE_BY_TAX_TY_CD,
  round2,
  splitTaxInclusiveAmount,
} from './oscu-tax-rates';

export class OscuSalesRequestBuilder {
  static build(params: {
    payload: EtimsInvoicePayload;
    tin: string;
    bhfId: string;
    cmcKey: string;
    now?: Date;
  }): OscuTrnsSalesSaveWrReq {
    const now =
      params.payload.saleDate != null
        ? new Date(`${params.payload.saleDate}T00:00:00Z`)
        : (params.now ?? new Date());
    const yyyyMMdd = formatYyyyMMdd(now);
    const yyyyMMddhhmmss = formatYyyyMMddhhmmss(now);

    const itemList = params.payload.lines.map((l, idx) => {
      // KRA treats splyAmt (qty * unitPrice) as the tax-INCLUSIVE line total and
      // derives taxblAmt/taxAmt from it, rather than accepting a separately-computed
      // tax-exclusive taxblAmt + taxAmt on top -- confirmed live 2026-08-11: a request
      // with taxblAmt: splyAmt (i.e. treating unitPrice as tax-exclusive) was rejected
      // with "Invalid taxblAmt on item: N. Expected: <splyAmt/rate>, But Found: <splyAmt>".
      // Same rule as insertStockIO (see oscu-payload-gotchas.md).
      const splyAmt = round2(l.quantity * l.unitPrice);
      const { taxblAmt, taxAmt } = splitTaxInclusiveAmount(splyAmt, l.taxTyCd);
      const totAmt = splyAmt;
      return {
        itemSeq: idx + 1,
        itemClsCd: l.classificationCode,
        itemCd: l.itemCode,
        itemNm: l.description,
        bcd: null,
        pkgUnitCd: l.packagingUnitCode,
        // KRA rejects pkg: 0 with "Invalid pkg for ItemList N. Expected: <qty>, Found: 0"
        // (confirmed live 2026-08-11) -- it wants a real package count, not a placeholder.
        pkg: l.quantity,
        qtyUnitCd: l.unitCode,
        qty: l.quantity,
        prc: l.unitPrice,
        splyAmt,
        dcRt: 0,
        dcAmt: 0,
        taxTyCd: l.taxTyCd,
        taxblAmt,
        taxAmt,
        totAmt,
      };
    });

    const taxBuckets = bucketTax(itemList);

    const rcptTyCd: string =
      params.payload.receiptTypeCode ??
      (params.payload.documentType === 'CREDIT_NOTE' ? 'R' : 'S');

    const pmtTyCd: string = params.payload.paymentTypeCode ?? '01';

    const salesSttsCd: string = params.payload.invoiceStatusCode ?? '02';

    const salesTyCd: string = params.payload.salesTypeCode ?? 'N';

    const rfdDt: string | null =
      params.payload.documentType === 'CREDIT_NOTE'
        ? normalizeYyyyMMddhhmmss(params.payload.creditNoteDate)
        : null;

    const rfdRsnCd: string | null =
      params.payload.documentType === 'CREDIT_NOTE'
        ? normalizeReasonCode(params.payload.creditNoteReasonCode)
        : null;

    return {
      tin: params.tin,
      bhfId: params.bhfId,
      cmcKey: params.cmcKey,
      trdInvcNo: params.payload.documentNumber,
      invcNo: params.payload.invoiceSequence,
      orgInvcNo:
        params.payload.documentType === 'CREDIT_NOTE'
          ? (params.payload.originalInvoiceSequence ??
            safeParseInt(params.payload.originalDocumentNumber ?? '') ??
            0)
          : 0,
      custTin: params.payload.customerPin ?? null,
      custNm: params.payload.customerName ?? null,
      salesTyCd,
      rcptTyCd,
      pmtTyCd,
      salesSttsCd,
      cfmDt: yyyyMMddhhmmss,
      salesDt: yyyyMMdd,
      stockRlsDt: yyyyMMddhhmmss,
      cnclReqDt: null,
      cnclDt: null,
      rfdDt,
      rfdRsnCd,
      totItemCnt: itemList.length,
      taxblAmtA: taxBuckets.taxblAmtA,
      taxblAmtB: taxBuckets.taxblAmtB,
      taxblAmtC: taxBuckets.taxblAmtC,
      taxblAmtD: taxBuckets.taxblAmtD,
      taxblAmtE: taxBuckets.taxblAmtE,
      taxRtA: OSCU_TAX_RATE_BY_TAX_TY_CD.A,
      taxRtB: OSCU_TAX_RATE_BY_TAX_TY_CD.B,
      taxRtC: OSCU_TAX_RATE_BY_TAX_TY_CD.C,
      taxRtD: OSCU_TAX_RATE_BY_TAX_TY_CD.D,
      taxRtE: OSCU_TAX_RATE_BY_TAX_TY_CD.E,
      taxAmtA: taxBuckets.taxAmtA,
      taxAmtB: taxBuckets.taxAmtB,
      taxAmtC: taxBuckets.taxAmtC,
      taxAmtD: taxBuckets.taxAmtD,
      taxAmtE: taxBuckets.taxAmtE,
      totTaxblAmt: taxBuckets.totTaxblAmt,
      totTaxAmt: taxBuckets.totTaxAmt,
      // = sum of item totAmt (each = splyAmt, tax-inclusive) -- NOT payload.totalAmount,
      // which double-counts tax under the old (incorrect) exclusive-pricing assumption.
      totAmt: round2(itemList.reduce((sum, i) => sum + i.totAmt, 0)),
      prchrAcptcYn: params.payload.purchaseAcceptanceYn ?? 'N',
      remark: null,
      regrId: 'sync2books',
      regrNm: 'sync2books',
      modrId: 'sync2books',
      modrNm: 'sync2books',
      receipt: {
        custTin: params.payload.customerPin ?? null,
        custMblNo: null,
        rcptPbctDt: yyyyMMddhhmmss,
        trdeNm: null,
        adrs: null,
        topMsg: null,
        btmMsg: null,
        prchrAcptcYn: 'N',
      },
      itemList,
    };
  }
}

function bucketTax(
  items: Array<{ taxTyCd: string; taxblAmt: number; taxAmt: number }>,
): {
  taxblAmtA: number;
  taxblAmtB: number;
  taxblAmtC: number;
  taxblAmtD: number;
  taxblAmtE: number;
  taxAmtA: number;
  taxAmtB: number;
  taxAmtC: number;
  taxAmtD: number;
  taxAmtE: number;
  totTaxblAmt: number;
  totTaxAmt: number;
} {
  const sums = {
    A: { taxbl: 0, tax: 0 },
    B: { taxbl: 0, tax: 0 },
    C: { taxbl: 0, tax: 0 },
    D: { taxbl: 0, tax: 0 },
    E: { taxbl: 0, tax: 0 },
  } as const;

  for (const i of items) {
    const key = (i.taxTyCd || 'D').toUpperCase() as keyof typeof sums;
    const bucket = sums[key] ?? sums.D;
    // @ts-expect-error readonly bucket typing
    bucket.taxbl += i.taxblAmt;
    // @ts-expect-error readonly bucket typing
    bucket.tax += i.taxAmt;
  }

  const taxblAmtA = round2(sums.A.taxbl);
  const taxblAmtB = round2(sums.B.taxbl);
  const taxblAmtC = round2(sums.C.taxbl);
  const taxblAmtD = round2(sums.D.taxbl);
  const taxblAmtE = round2(sums.E.taxbl);
  const taxAmtA = round2(sums.A.tax);
  const taxAmtB = round2(sums.B.tax);
  const taxAmtC = round2(sums.C.tax);
  const taxAmtD = round2(sums.D.tax);
  const taxAmtE = round2(sums.E.tax);

  return {
    taxblAmtA,
    taxblAmtB,
    taxblAmtC,
    taxblAmtD,
    taxblAmtE,
    taxAmtA,
    taxAmtB,
    taxAmtC,
    taxAmtD,
    taxAmtE,
    totTaxblAmt: round2(
      taxblAmtA + taxblAmtB + taxblAmtC + taxblAmtD + taxblAmtE,
    ),
    totTaxAmt: round2(taxAmtA + taxAmtB + taxAmtC + taxAmtD + taxAmtE),
  };
}

function formatYyyyMMdd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function formatYyyyMMddhhmmss(d: Date): string {
  const yyyyMMdd = formatYyyyMMdd(d);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyyMMdd}${hh}${mm}${ss}`;
}

function normalizeYyyyMMddhhmmss(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (/^\d{14}$/.test(trimmed)) return trimmed;
  if (/^\d{8}$/.test(trimmed)) return `${trimmed}000000`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-');
    return `${y}${m}${d}000000`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatYyyyMMddhhmmss(parsed);
}

function normalizeReasonCode(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed;
}

function safeParseInt(s: string): number | null {
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
