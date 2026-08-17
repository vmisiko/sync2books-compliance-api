import * as PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import type { ComplianceDocument } from '../../domain/entities/compliance-document.entity';
import type { ComplianceConnection } from '../../../shared/domain/entities/compliance-connection.entity';
import type { ComplianceItem } from '../../../shared/domain/entities/compliance-item.entity';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';

export interface EtimsReceiptData {
  document: ComplianceDocument;
  connection: ComplianceConnection | null;
  itemsById: Map<string, ComplianceItem>;
  receiptNumber: number | null;
  receiptSignature: string;
  internalData: string;
  etimsUrl: string | null;
}

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
  const { document, connection, itemsById } = data;

  const qrPngBuffer = data.etimsUrl
    ? await QRCode.toBuffer(data.etimsUrl, { width: 220, margin: 1 })
    : null;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc
      .fontSize(16)
      .text(DOCUMENT_TITLE[document.documentType] ?? 'TAX RECEIPT', {
        align: 'center',
      });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#555');
    doc.text(`KRA PIN: ${connection?.kraPin ?? '-'}`, { align: 'center' });
    doc.text(`Branch: ${connection?.kraBhfId ?? '-'}`, { align: 'center' });
    doc.text(`Device: ${connection?.deviceId ?? '-'}`, { align: 'center' });
    doc.fillColor('#000');
    doc.moveDown();

    doc.fontSize(10);
    doc.text(`Invoice No: ${document.documentNumber}`);
    doc.text(`Sale Date: ${document.saleDate ?? '-'}`);
    doc.text(`Customer PIN: ${document.customerPin ?? 'N/A'}`);
    doc.moveDown(0.5);

    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold');
    doc.text('Description', 40, doc.y, { continued: true, width: 260 });
    doc.text('Qty', 300, doc.y, { continued: true, width: 60 });
    doc.text('Unit Price', 360, doc.y, { continued: true, width: 90 });
    doc.text('Total', 450, doc.y, { width: 100 });
    doc.font('Helvetica');
    doc.moveDown(0.3);

    for (const line of document.lines) {
      const item = itemsById.get(line.itemId);
      const total = line.quantity * line.unitPrice + line.taxAmount;
      const y = doc.y;
      doc.text(line.description || item?.name || line.itemId, 40, y, {
        width: 260,
      });
      doc.text(String(line.quantity), 300, y, { width: 60 });
      doc.text(line.unitPrice.toFixed(2), 360, y, { width: 90 });
      doc.text(total.toFixed(2), 450, y, { width: 100 });
      doc.moveDown(0.2);
    }

    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold');
    doc.text(`Subtotal: ${document.subtotalAmount.toFixed(2)}`, {
      align: 'right',
    });
    doc.text(`Tax: ${document.totalTax.toFixed(2)}`, { align: 'right' });
    doc.text(`Total: ${document.totalAmount.toFixed(2)} ${document.currency}`, {
      align: 'right',
    });
    doc.font('Helvetica');
    doc.moveDown();

    doc.fontSize(9).fillColor('#333');
    doc.text(`eTIMS Receipt No: ${data.receiptNumber ?? '-'}`);
    doc.text(`Receipt Signature: ${data.receiptSignature || '-'}`);
    doc.text(`Internal Data: ${data.internalData || '-'}`);
    doc.fillColor('#000');
    doc.moveDown();

    if (qrPngBuffer) {
      const qrX = doc.page.width - doc.page.margins.right - 120;
      doc.image(qrPngBuffer, qrX, doc.y, { width: 120 });
      doc
        .fontSize(8)
        .fillColor('#555')
        .text('Scan to verify on eTIMS', qrX, doc.y + 122, {
          width: 120,
          align: 'center',
        });
    }

    doc.end();
  });
}
