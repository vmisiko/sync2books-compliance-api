import type { SaleReportDto } from '../../controller/dto/sales-report.dto';

/**
 * Plain HTML receipt body for the "email receipt" action. Kept separate from
 * `etims-receipt-pdf.generator.ts` (which renders the full KRA-format PDF,
 * attached separately when the sale has been ACCEPTED) -- this is just the
 * email's inline summary.
 */
export function renderReceiptEmailHtml(report: SaleReportDto): string {
  const rows = report.itemList
    .map(
      (item) => `
        <tr>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;">${item.quantity}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;">${item.unitPrice.toFixed(2)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;">${item.totalAmount.toFixed(2)}</td>
        </tr>`,
    )
    .join('');

  const total = report.itemList.reduce((sum, i) => sum + i.totalAmount, 0);

  return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin-bottom:4px;">Sale Invoice</h2>
      <p style="color:#555;margin-top:0;">Invoice no: ${report.traderInvoiceNumber}${
        report.date ? ` &middot; ${report.date}` : ''
      }</p>
      ${report.customerName ? `<p>To: ${report.customerName}</p>` : ''}
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Qty</th>
            <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Unit Price</th>
            <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="text-align:right;font-weight:bold;margin-top:8px;">Total: ${total.toFixed(2)}</p>
      ${
        report.receiptNumber
          ? `<p style="color:#555;font-size:12px;">KRA receipt no: ${report.receiptNumber}</p>`
          : ''
      }
    </div>
  `;
}
