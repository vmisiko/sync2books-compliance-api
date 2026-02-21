import type { EtimsInvoicePayload } from './etims-payload.types';

export interface OscuTrnsSalesSaveWrReq {
  tin: string;
  bhfId: string;
  cmcKey: string;
  trdInvcNo: string;
  invcNo: number;
  orgInvcNo: number;
  custTin: string | null;
  custNm: string | null;
  rcptTyCd: string;
  pmtTyCd: string;
  salesSttsCd: string;
  cfmDt: string;
  salesDt: string;
  stockRlsDt: string;
  totItemCnt: number;
  taxblAmtA: number;
  taxblAmtB: number;
  taxblAmtC: number;
  taxblAmtD: number;
  taxblAmtE: number;
  taxRtA: number;
  taxRtB: number;
  taxRtC: number;
  taxRtD: number;
  taxRtE: number;
  taxAmtA: number;
  taxAmtB: number;
  taxAmtC: number;
  taxAmtD: number;
  taxAmtE: number;
  totTaxblAmt: number;
  totTaxAmt: number;
  totAmt: number;
  remark: string | null;
  regrId: string;
  regrNm: string;
  modrId: string;
  modrNm: string;
  receipt: {
    custTin: string | null;
    custMblNo: string | null;
    rcptPbctDt: string;
    trdeNm: string | null;
    adrs: string | null;
    topMsg: string | null;
    btmMsg: string | null;
    prchrAcptcYn: 'Y' | 'N';
  };
  itemList: Array<{
    itemSeq: number;
    itemClsCd: string;
    itemCd: string;
    itemNm: string;
    bcd: string | null;
    pkgUnitCd: string;
    pkg: number;
    qtyUnitCd: string;
    qty: number;
    prc: number;
    splyAmt: number;
    dcRt: number;
    dcAmt: number;
    taxTyCd: string;
    taxblAmt: number;
    taxAmt: number;
    totAmt: number;
  }>;
}

const TAX_RATE_BY_TAX_TY_CD: Record<string, number> = {
  A: 0,
  B: 16,
  C: 0,
  D: 0,
  E: 8,
};

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
      const splyAmt = round2(l.quantity * l.unitPrice);
      const taxAmt = round2(l.taxAmount);
      const totAmt = round2(splyAmt + taxAmt);
      return {
        itemSeq: idx + 1,
        itemClsCd: l.classificationCode,
        itemCd: l.itemCode,
        itemNm: l.description,
        bcd: null,
        pkgUnitCd: l.packagingUnitCode,
        pkg: 0,
        qtyUnitCd: l.unitCode,
        qty: l.quantity,
        prc: l.unitPrice,
        splyAmt,
        dcRt: 0,
        dcAmt: 0,
        taxTyCd: l.taxTyCd,
        taxblAmt: splyAmt,
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

    return {
      tin: params.tin,
      bhfId: params.bhfId,
      cmcKey: params.cmcKey,
      trdInvcNo: params.payload.documentNumber,
      invcNo: safeParseInt(params.payload.documentNumber) ?? 1,
      orgInvcNo: 0,
      custTin: params.payload.customerPin ?? null,
      custNm: null,
      rcptTyCd,
      pmtTyCd,
      salesSttsCd,
      cfmDt: yyyyMMddhhmmss,
      salesDt: yyyyMMdd,
      stockRlsDt: yyyyMMddhhmmss,
      totItemCnt: itemList.length,
      taxblAmtA: taxBuckets.taxblAmtA,
      taxblAmtB: taxBuckets.taxblAmtB,
      taxblAmtC: taxBuckets.taxblAmtC,
      taxblAmtD: taxBuckets.taxblAmtD,
      taxblAmtE: taxBuckets.taxblAmtE,
      taxRtA: TAX_RATE_BY_TAX_TY_CD.A,
      taxRtB: TAX_RATE_BY_TAX_TY_CD.B,
      taxRtC: TAX_RATE_BY_TAX_TY_CD.C,
      taxRtD: TAX_RATE_BY_TAX_TY_CD.D,
      taxRtE: TAX_RATE_BY_TAX_TY_CD.E,
      taxAmtA: taxBuckets.taxAmtA,
      taxAmtB: taxBuckets.taxAmtB,
      taxAmtC: taxBuckets.taxAmtC,
      taxAmtD: taxBuckets.taxAmtD,
      taxAmtE: taxBuckets.taxAmtE,
      totTaxblAmt: taxBuckets.totTaxblAmt,
      totTaxAmt: taxBuckets.totTaxAmt,
      totAmt: round2(params.payload.totalAmount),
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

function safeParseInt(s: string): number | null {
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
