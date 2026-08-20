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

/**
 * Renders the KRA eTIMS/OSCU sale receipt as a PDF, on the fly, from data
 * already persisted for an ACCEPTED compliance document. Nothing is cached --
 * regenerated per request from `rcptSign`/`intrlData`/`curRcptNo`.
 */
export async function generateEtimsReceiptPdf(
  data: EtimsReceiptData,
): Promise<Buffer> {
  const { document, connection, itemsById, taxBuckets } = data;

  const qrPngBuffer = data.etimsUrl
    ? await QRCode.toBuffer(data.etimsUrl, { width: 220, margin: 1 })
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

    // Header: title left, QR top-right (mirrors the DigiTax layout).
    doc.fontSize(20).font('Helvetica-Bold');
    doc.text(DOCUMENT_TITLE[document.documentType] ?? 'TAX RECEIPT', leftX, 40);
    doc.font('Helvetica');

    if (qrPngBuffer) {
      const qrX = pageRight - 90;
      doc.image(qrPngBuffer, qrX, 40, { width: 90 });
      doc
        .fontSize(7)
        .fillColor('#555')
        .text('SCAN ME', qrX, 34, { width: 90, align: 'center' });
      doc.fillColor('#000');
    }

    doc.y = Math.max(doc.y, 140);
    doc.moveTo(leftX, doc.y).lineTo(pageRight, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.8);

    // Three-column details block: Sale Invoice / Buyer / Supplier.
    const detailsY = doc.y;
    doc.fontSize(9);
    doc.font('Helvetica-Bold').text('Invoice Details', leftX, detailsY, { width: 170 });
    doc.font('Helvetica');
    doc.text(`Invoice no: ${document.documentNumber}`, leftX, doc.y, { width: 170 });
    doc.text(`Date: ${document.saleDate ?? '-'}`, leftX, doc.y, { width: 170 });
    if (document.originalDocumentNumber) {
      doc.text(`Ref invoice: ${document.originalDocumentNumber}`, leftX, doc.y, {
        width: 170,
      });
    }

    doc.font('Helvetica-Bold').text('Buyer Details', midX, detailsY, { width: 160 });
    doc.font('Helvetica');
    doc.text(document.customerName || '—', midX, doc.y, { width: 160 });
    if (document.customerPin) doc.text(`PIN: ${document.customerPin}`, midX, doc.y, { width: 160 });
    if (document.customerPhoneNumber) {
      doc.text(`Tel: ${document.customerPhoneNumber}`, midX, doc.y, { width: 160 });
    }

    doc.font('Helvetica-Bold').text('Supplier Details', rightX, detailsY, { width: 155 });
    doc.font('Helvetica');
    doc.text(data.supplierName || '—', rightX, doc.y, { width: 155 });
    doc.text(`PIN: ${connection?.kraPin ?? '-'}`, rightX, doc.y, { width: 155 });
    doc.text(`Branch: ${connection?.kraBhfId ?? '-'} · Device: ${connection?.deviceId ?? '-'}`, rightX, doc.y, {
      width: 155,
    });

    doc.moveDown(0.8);
    doc.moveTo(leftX, doc.y).lineTo(pageRight, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').fontSize(10);
    {
      const headerY = doc.y;
      doc.text('Item Description', leftX, headerY, { width: 220 });
      doc.text('Tax Cat.', 260, headerY, { width: 60 });
      doc.text('Unit Price', 320, headerY, { width: 70 });
      doc.text('Qty', 390, headerY, { width: 50 });
      doc.text('Total', 445, headerY, { width: 105, align: 'right' });
    }
    doc.font('Helvetica');
    doc.moveDown(1);

    for (const line of document.lines) {
      const item = itemsById.get(line.itemId);
      const total = line.quantity * line.unitPrice + line.taxAmount;
      const y = doc.y;
      const name = item?.name || line.itemId;
      doc.fontSize(9).text(name, leftX, y, { width: 220 });
      if (line.description && line.description !== name) {
        doc.fontSize(8).fillColor('#666').text(line.description, leftX, doc.y, {
          width: 220,
        });
        doc.fillColor('#000');
      }
      const taxTyCd = line.taxTyCdSnapshot ?? '';
      doc.fontSize(9).text(taxTyCd, 260, y, { width: 60 });
      doc.text(line.unitPrice.toFixed(2), 320, y, { width: 70 });
      doc.text(`x${line.quantity}`, 390, y, { width: 50 });
      doc.text(total.toFixed(2), 445, y, { width: 105, align: 'right' });
      doc.moveDown(0.3);
    }

    doc.moveDown(0.3);
    doc.moveTo(leftX, doc.y).lineTo(pageRight, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.5);

    // Tax category breakdown, only non-zero buckets (mirrors DigiTax's compact table).
    const buckets = (
      [
        { key: 'A', taxable: taxBuckets.taxableAmountA, rate: taxBuckets.taxRateA, amt: taxBuckets.taxAmountA },
        { key: 'B', taxable: taxBuckets.taxableAmountB, rate: taxBuckets.taxRateB, amt: taxBuckets.taxAmountB },
        { key: 'C', taxable: taxBuckets.taxableAmountC, rate: taxBuckets.taxRateC, amt: taxBuckets.taxAmountC },
        { key: 'D', taxable: taxBuckets.taxableAmountD, rate: taxBuckets.taxRateD, amt: taxBuckets.taxAmountD },
        { key: 'E', taxable: taxBuckets.taxableAmountE, rate: taxBuckets.taxRateE, amt: taxBuckets.taxAmountE },
      ] as const
    ).filter((b) => b.taxable !== 0 || b.amt !== 0);

    if (buckets.length > 0) {
      doc.font('Helvetica-Bold').fontSize(9);
      {
        const taxHeaderY = doc.y;
        doc.text('Tax Category', 260, taxHeaderY, { width: 90 });
        doc.text('Rate (%)', 350, taxHeaderY, { width: 60 });
        doc.text('Taxable Amt', 410, taxHeaderY, { width: 75 });
        doc.text('Tax Amt', 485, taxHeaderY, { width: 65, align: 'right' });
      }
      doc.font('Helvetica');
      doc.moveDown(0.5);

      for (const b of buckets) {
        const y = doc.y;
        doc.text(`${TAX_CATEGORY_LABELS[b.key]} ${b.rate}%`, 260, y, { width: 90 });
        doc.text(String(b.rate), 350, y, { width: 60 });
        doc.text(b.taxable.toFixed(2), 410, y, { width: 75 });
        doc.text(b.amt.toFixed(2), 485, y, { width: 65, align: 'right' });
        doc.moveDown(0.3);
      }
      doc.moveDown(0.2);
    }

    doc.font('Helvetica-Bold');
    doc.text(`Subtotal: ${document.subtotalAmount.toFixed(2)}`, { align: 'right' });
    doc.text(`Tax: ${document.totalTax.toFixed(2)}`, { align: 'right' });
    doc.text(`Total: ${document.totalAmount.toFixed(2)} ${document.currency}`, {
      align: 'right',
    });
    doc.font('Helvetica');
    doc.moveDown(0.8);

    if (data.paymentTypeDescription) {
      doc.font('Helvetica-Bold').fontSize(10).text('Payment Details');
      doc.font('Helvetica').text(data.paymentTypeDescription);
      doc.moveDown(0.6);
    }

    doc.fontSize(9).fillColor('#333');
    doc.text(`Date: ${document.saleDate ?? '-'}`);
    doc.text(`SCU Id: ${connection?.deviceId ?? '-'}`);
    doc.text(
      `SCU Invoice No: ${connection?.deviceId ?? '-'}/${data.receiptNumber ?? '-'}`,
    );
    doc.text(`Signature: ${data.receiptSignature || '-'}`);
    doc.text(`Internal Data: ${data.internalData || '-'}`);
    doc.fillColor('#000');
    doc.moveDown();

    doc.end();
  });
}
