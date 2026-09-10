import * as PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import type { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import type { ComplianceConnection } from '../../../shared/domain/entities/compliance-connection.entity';
import type { ComplianceItem } from '../../../shared/domain/entities/compliance-item.entity';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';

export interface TaxBuckets {
  taxableAmountA: number;
  taxableAmountB: number;
  taxableAmountC: number;
  taxableAmountD: number;
  taxableAmountE: number;
  taxAmountA: number;
  taxAmountB: number;
  taxAmountC: number;
  taxAmountD: number;
  taxAmountE: number;
  taxRateA: number;
  taxRateB: number;
  taxRateC: number;
  taxRateD: number;
  taxRateE: number;
}

export interface EtimsReceiptData {
  document: ComplianceDocument;
  connection: ComplianceConnection | null;
  itemsById: Map<string, ComplianceItem>;
  receiptNumber: number | null;
  receiptSignature: string;
  internalData: string;
  etimsUrl: string | null;
  supplierName: string | null;
  paymentTypeDescription: string | null;
  taxBuckets: TaxBuckets;
  /** OSCU `totRcptNo` (total receipt counter across all receipt types) -- part of the "A/B RT" receipt counter, TIS §6.23.5. */
  totRcptNo: string | null;
  /** OSCU `sdcDateTime` (`yyyyMMddhhmmss`) -- the SCU's own clock, required by TIS §6.23.2 in place of the document's own saleDate. */
  sdcDateTime: string | null;
  /** Receipt label per TIS §4.3 (NS/NC/...), e.g. "NS". Null only for a document that predates this field. */
  receiptLabel: string | null;
  /**
   * For CREDIT_NOTE only: the original sale's CU Invoice No. already composed as
   * `{sdcId}/{curRcptNo} {label}` (e.g. "KRACU0400001074/9 NS") -- TIS page 10's
   * "ORIGINAL CU INVOICE NO.#". Computed by the caller (needs a lookup of the
   * original ComplianceDocument), null for a normal sale or when the original
   * can't be resolved.
   */
  originalCuInvoiceNo?: string | null;
}

const TAX_CATEGORY_LABELS: Record<'A' | 'B' | 'C' | 'D' | 'E', string> = {
  A: 'A-Exempt',
  B: 'B-VAT',
  C: 'C-Zero Rated',
  D: 'D-Non VAT',
  E: 'E-VAT',
};

const DOCUMENT_TITLE: Record<DocumentType, string> = {
  [DocumentType.SALE]: 'TAX RECEIPT',
  [DocumentType.SALE_INVOICE]: 'TAX INVOICE',
  [DocumentType.CREDIT_NOTE]: 'CREDIT NOTE',
  [DocumentType.PURCHASE]: 'PURCHASE RECEIPT',
  [DocumentType.EXPORT]: 'EXPORT INVOICE',
  [DocumentType.REVERSE_INVOICE]: 'REVERSED INVOICE',
};

const DEFAULT_HEADER_MESSAGE = 'Thank you for shopping with us';
const DEFAULT_FOOTER_MESSAGE = 'THANK YOU\nWE LOOK FORWARD TO EARNING YOUR BUSINESS';

/** TIS §6.23.6/§6.23.7: internal data and receipt signature print dashed after every 4th character. */
export function dashEvery4(s: string): string {
  if (!s) return s;
  return s.match(/.{1,4}/g)?.join('-') ?? s;
}

/** OSCU `sdcDateTime` is `yyyyMMddhhmmss`. TIS §6.23.2 wants `dd/mm/yyyy` + `hh:mm:ss` printed from the SCU's own clock, not the document's saleDate. */
export function formatScuDateTime(sdcDateTime: string | null): { date: string; time: string } {
  if (!sdcDateTime || sdcDateTime.length < 14) return { date: '-', time: '-' };
  const yyyy = sdcDateTime.slice(0, 4);
  const mm = sdcDateTime.slice(4, 6);
  const dd = sdcDateTime.slice(6, 8);
  const hh = sdcDateTime.slice(8, 10);
  const mi = sdcDateTime.slice(10, 12);
  const ss = sdcDateTime.slice(12, 14);
  return { date: `${dd}/${mm}/${yyyy}`, time: `${hh}:${mi}:${ss}` };
}

function formatTisDateTime(d: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

/**
 * Renders the KRA eTIMS/OSCU receipt as a PDF, on the fly, from data already
 * persisted for an ACCEPTED compliance document. Nothing is cached -- regenerated
 * per request from `rcptSign`/`intrlData`/`curRcptNo`/`totRcptNo`/`sdcDateTime`.
 *
 * Field-by-field against TIS for OSCU/VSCU Technical Specifications v2.0, page 8
 * (Normal Invoice sample) and page 10 (Normal Credit Note sample) -- see
 * `.docs/TIS_TEMPLATE_CONFORMANCE_PLAN.md`'s two gap tables for the checklist this
 * was written against. Previously modeled on DigiTax's layout; this version follows
 * the TIS spec's own field set and ordering instead, only borrowing DigiTax's visual
 * density where the spec is silent on layout.
 */
export async function generateEtimsReceiptPdf(
  data: EtimsReceiptData,
): Promise<Buffer> {
  const { document, connection, itemsById, taxBuckets } = data;
  const isCreditNote =
    document.documentType === DocumentType.CREDIT_NOTE ||
    document.documentType === DocumentType.REVERSE_INVOICE;
  /**
   * Credit-note amounts must render negative per the page 10 sample regardless of
   * the sign the domain model happens to store them in -- Math.abs first makes this
   * idempotent either way, so this is purely a presentation-layer guarantee.
   */
  const signed = (n: number): number => (isCreditNote ? -Math.abs(n) : n);
  const money = (n: number): string => signed(n).toFixed(2);

  const qrPngBuffer = data.etimsUrl
    ? await QRCode.toBuffer(data.etimsUrl, { width: 160, margin: 1 })
    : null;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const leftX = 40;
    const midX = 230;
    const rightX = 400;
    const pageRight = 555;

    // --- Header: KRA logo placeholder, trade name/address/PIN, title, QR top-right ---
    // No official KRA logo asset is bundled -- see TIS_TEMPLATE_CONFORMANCE_PLAN.md
    // §2.2. A bordered placeholder holds its place rather than silently omitting it
    // (TIS §6.28 requires the real logo on every receipt).
    doc.rect(leftX, 38, 34, 34).strokeColor('#999').stroke();
    doc.fontSize(7).fillColor('#999').text('KRA', leftX, 51, { width: 34, align: 'center' });
    doc.fillColor('#000');

    const nameX = leftX + 44;
    doc.fontSize(13).font('Helvetica-Bold').text(data.supplierName || '—', nameX, 38, { width: 300 });
    doc.font('Helvetica').fontSize(9);
    const addressParts = [connection?.tradeAddressLine1, connection?.tradeCity].filter(Boolean);
    if (addressParts.length > 0) {
      doc.text(addressParts.join(', '), nameX, doc.y, { width: 300 });
    }
    doc.text(`PIN: ${connection?.kraPin ?? '-'}`, nameX, doc.y, { width: 300 });

    doc.fontSize(16).font('Helvetica-Bold');
    doc.text(DOCUMENT_TITLE[document.documentType] ?? 'TAX RECEIPT', nameX, doc.y + 4, { width: 300 });
    doc.font('Helvetica');

    if (qrPngBuffer) {
      const qrX = pageRight - 80;
      doc.image(qrPngBuffer, qrX, 38, { width: 80 });
      doc.fontSize(7).fillColor('#555').text('SCAN ME', qrX, 32, { width: 80, align: 'center' });
      doc.fillColor('#000');
    }

    doc.y = Math.max(doc.y, 128);
    doc.moveDown(0.4);

    // Commercial message above the item section (page 8 sample: "Welcome to our shop").
    doc.fontSize(9).fillColor('#333').text(
      connection?.receiptHeaderMessage || DEFAULT_HEADER_MESSAGE,
      leftX,
      doc.y,
      { width: pageRight - leftX },
    );
    doc.fillColor('#000');
    doc.moveDown(0.5);
    doc.moveTo(leftX, doc.y).lineTo(pageRight, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.6);

    // --- Credit note: original receipt reference + mandatory approval statement (page 10) ---
    if (isCreditNote) {
      doc.font('Helvetica-Bold').fontSize(10);
      doc.text(
        `ORIGINAL CU INVOICE NO.#: ${data.originalCuInvoiceNo ?? document.originalDocumentNumber ?? '-'}`,
        leftX,
        doc.y,
      );
      doc.fontSize(9).font('Helvetica');
      doc.text('CREDIT NOTE IS APPROVED ONLY FOR ORIGINAL SALES RECEIPT', leftX, doc.y);
      doc.moveDown(0.5);
      doc.moveTo(leftX, doc.y).lineTo(pageRight, doc.y).strokeColor('#ccc').stroke();
      doc.moveDown(0.6);
    }

    // --- Invoice/Buyer/Supplier details block ---
    const detailsY = doc.y;
    doc.fontSize(9);
    doc.font('Helvetica-Bold').text('Invoice Details', leftX, detailsY, { width: 170 });
    doc.font('Helvetica');
    doc.text(`Invoice no: ${document.documentNumber}`, leftX, doc.y, { width: 170 });
    doc.text(`Date: ${document.saleDate ?? '-'}`, leftX, doc.y, { width: 170 });

    doc.font('Helvetica-Bold').text('Buyer Details', midX, detailsY, { width: 160 });
    doc.font('Helvetica');
    doc.text(document.customerName || '—', midX, doc.y, { width: 160 });
    // Buyer PIN is optional per TIS §5.1.3/page 8 sample -- print it when present,
    // never invent one; a blank buyer PIN is a legitimate walk-in sale.
    if (document.customerPin) doc.text(`Buyer PIN: ${document.customerPin}`, midX, doc.y, { width: 160 });
    if (document.customerPhoneNumber) {
      doc.text(`Tel: ${document.customerPhoneNumber}`, midX, doc.y, { width: 160 });
    }

    doc.font('Helvetica-Bold').text('Supplier Details', rightX, detailsY, { width: 155 });
    doc.font('Helvetica');
    doc.text(data.supplierName || '—', rightX, doc.y, { width: 155 });
    doc.text(`Branch: ${connection?.kraBhfId ?? '-'} · Device: ${connection?.deviceId ?? '-'}`, rightX, doc.y, {
      width: 155,
    });

    doc.moveDown(0.8);
    doc.moveTo(leftX, doc.y).lineTo(pageRight, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.6);

    // --- Item lines: description, unit price, qty, total price with tax designation suffix (page 8: "1000.00A-EX") ---
    doc.font('Helvetica-Bold').fontSize(10);
    {
      const headerY = doc.y;
      doc.text('Item Description', leftX, headerY, { width: 210 });
      doc.text('Type', 255, headerY, { width: 40 });
      doc.text('Unit Price', 300, headerY, { width: 65 });
      doc.text('Qty', 368, headerY, { width: 40 });
      doc.text('Total', 445, headerY, { width: 105, align: 'right' });
    }
    doc.font('Helvetica');
    doc.moveDown(1);

    for (const line of document.lines) {
      const item = itemsById.get(line.itemId);
      const total = line.quantity * line.unitPrice + line.taxAmount;
      const y = doc.y;
      const name = item?.name || line.itemId;
      const isService = item?.productTypeCode === '3';
      doc.fontSize(9).text(name, leftX, y, { width: 210 });
      if (line.description && line.description !== name) {
        doc.fontSize(8).fillColor('#666').text(line.description, leftX, doc.y, { width: 210 });
        doc.fillColor('#000');
      }
      const taxTyCd = line.taxTyCdSnapshot ?? '';
      doc.fontSize(9).text(isService ? 'Svc' : 'Goods', 255, y, { width: 40 });
      doc.text(line.unitPrice.toFixed(2), 300, y, { width: 65 });
      doc.text(`x${line.quantity}`, 368, y, { width: 40 });
      doc.text(`${money(total)}${taxTyCd}`, 445, y, { width: 105, align: 'right' });
      doc.moveDown(0.3);
    }

    doc.moveDown(0.2);
    doc.moveTo(leftX, doc.y).lineTo(pageRight, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.4);

    // --- Totals block -- page 8 order: totals, then payment, then ITEMS NUMBER, THEN the
    // tax table (not the other way around -- an earlier version of this file put ITEMS
    // NUMBER and the tax table before the totals block). ---
    doc.font('Helvetica-Bold');
    doc.text(`${isCreditNote ? 'TOTAL' : 'SUB TOTAL'}: ${money(document.subtotalAmount)}`, { align: 'right' });
    doc.text(`${isCreditNote ? 'TOTAL TAX' : 'TAX'}: ${money(document.totalTax)}`, { align: 'right' });
    if (!isCreditNote) {
      doc.text(`TOTAL: ${money(document.totalAmount)} ${document.currency}`, { align: 'right' });
    }
    doc.font('Helvetica');
    doc.moveDown(0.6);

    if (data.paymentTypeDescription) {
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text(data.paymentTypeDescription, leftX, doc.y, { width: 200, continued: true });
      doc.font('Helvetica').text(`  ${money(document.totalAmount)}`, { align: 'right' });
    }

    // Item counter (TIS §6.25) -- number of lines shown, excludes voids (voided lines never persist here).
    doc.fontSize(9).text(`ITEMS NUMBER  ${document.lines.length}`, leftX, doc.y, { width: pageRight - leftX });
    doc.moveDown(0.4);
    doc.moveTo(leftX, doc.y).lineTo(pageRight, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.5);

    // --- Tax category table -- TIS §6.21/§6.22 and the page 8 sample: every programmed
    // rate (A/B/C/D/E) prints on every receipt, unconditionally, defaulting to 0.00 when
    // unused -- confirmed against a live KRA-certified receipt (DigiTax), which is more
    // authoritative here than a stricter reading of the spec text alone. This replaces an
    // earlier version of this file that only guaranteed row B and hid the rest when unused. ---
    doc.font('Helvetica-Bold').fontSize(9);
    const buckets = [
      { key: 'A', taxable: taxBuckets.taxableAmountA, rate: taxBuckets.taxRateA, amt: taxBuckets.taxAmountA },
      { key: 'B', taxable: taxBuckets.taxableAmountB, rate: taxBuckets.taxRateB, amt: taxBuckets.taxAmountB },
      { key: 'C', taxable: taxBuckets.taxableAmountC, rate: taxBuckets.taxRateC, amt: taxBuckets.taxAmountC },
      { key: 'D', taxable: taxBuckets.taxableAmountD, rate: taxBuckets.taxRateD, amt: taxBuckets.taxAmountD },
      { key: 'E', taxable: taxBuckets.taxableAmountE, rate: taxBuckets.taxRateE, amt: taxBuckets.taxAmountE },
    ] as const;
    {
      const taxHeaderY = doc.y;
      doc.text('Tax Category', leftX, taxHeaderY, { width: 130 });
      doc.text('Rate (%)', 175, taxHeaderY, { width: 60 });
      doc.text('Taxable Amt', 240, taxHeaderY, { width: 90 });
      doc.text('Tax Amt', 335, taxHeaderY, { width: 90, align: 'right' });
    }
    doc.font('Helvetica');
    doc.moveDown(0.5);

    for (const b of buckets) {
      const y = doc.y;
      const label = isCreditNote
        ? `TOTAL ${b.key}-${b.rate.toFixed(2)}%`
        : `${TAX_CATEGORY_LABELS[b.key]}`;
      doc.text(label, leftX, y, { width: 130 });
      doc.text(String(b.rate), 175, y, { width: 60 });
      doc.text(money(b.taxable), 240, y, { width: 90 });
      doc.text(money(b.amt), 335, y, { width: 90, align: 'right' });
      doc.moveDown(0.3);
    }
    doc.moveDown(0.3);
    doc.moveTo(leftX, doc.y).lineTo(pageRight, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.6);

    // --- SCU INFORMATION block (TIS §6.23) ---
    const scuDateTime = formatScuDateTime(data.sdcDateTime);
    const cuId = connection?.sdcId ?? connection?.deviceId ?? '-';
    const cuInvoiceNo = `${cuId}/${data.receiptNumber ?? '-'}`;
    const receiptLabel = data.receiptLabel ?? (isCreditNote ? 'NC' : 'NS');

    doc.font('Helvetica-Bold').fontSize(10).text('SCU INFORMATION', leftX, doc.y);
    doc.font('Helvetica').fontSize(9);
    doc.text(`Date: ${scuDateTime.date}   Time: ${scuDateTime.time}`, leftX, doc.y);
    doc.text(`CU ID: ${cuId}`, leftX, doc.y);
    doc.text(`CU Invoice No.: ${cuInvoiceNo} ${receiptLabel}`, leftX, doc.y);
    doc.text(
      `Receipt Counter: ${data.receiptNumber ?? '-'}/${data.totRcptNo ?? '-'} ${receiptLabel}`,
      leftX,
      doc.y,
    );
    doc.text(`Internal Data: ${dashEvery4(data.internalData || '') || '-'}`, leftX, doc.y);
    doc.text(`Receipt Signature: ${dashEvery4(data.receiptSignature || '') || '-'}`, leftX, doc.y);
    doc.moveDown(0.8);

    // --- TIS INFORMATION block (TIS §6.23's "optional category for TIS specific info") ---
    // Sync2Books has no separate TIS-internal receipt sequence today -- documentNumber
    // (our own trader invoice number) and the document's creation time stand in for it,
    // both real and traceable, until a dedicated TIS-sequence counter exists.
    const tisDateTime = formatTisDateTime(document.createdAt);
    doc.font('Helvetica-Bold').fontSize(10).text('TIS INFORMATION', leftX, doc.y);
    doc.font('Helvetica').fontSize(9);
    doc.text(`Receipt Number: ${document.documentNumber}`, leftX, doc.y);
    doc.text(`Date: ${tisDateTime.date}   Time: ${tisDateTime.time}`, leftX, doc.y);
    doc.moveDown(0.8);

    // Commercial message in the footer (page 8 sample: "THANK YOU ...").
    doc.fontSize(9).fillColor('#333').text(
      connection?.receiptFooterMessage || DEFAULT_FOOTER_MESSAGE,
      leftX,
      doc.y,
      { width: pageRight - leftX, align: 'center' },
    );
    doc.fillColor('#000');

    doc.end();
  });
}
