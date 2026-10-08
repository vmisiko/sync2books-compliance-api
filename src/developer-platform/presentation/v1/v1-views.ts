import type { CatalogItem } from '../../../catalog/domain/entities/catalog-item.entity';
import type { PurchaseInvoiceDto } from '../../../dashboard-purchases/application/dashboard-purchases.application.service';
import type { SaleReportDto } from '../../../sales/controller/dto/sales-report.dto';

/**
 * What the public API returns, deliberately narrower than what the service
 * holds.
 *
 * The normalized sale report carries fields that are internal by nature -- the
 * route of the internal sale endpoint, the OSCU device serial, ERP
 * receipt-attachment state, the source system. Handing the whole object over
 * would make each of those part of the contract the day an integrator first
 * depended on it, and would tell a curious caller how the platform is put
 * together. So every `/v1` response is built here, field by field, from an
 * allow-list: a new internal field added upstream stays private until someone
 * decides otherwise.
 */

export type V1SaleStatus =
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'cancelled'
  | 'ready_to_submit'
  | 'pending';

export function toV1Sale(report: SaleReportDto) {
  const accepted = report.status === 'completed';
  return {
    id: report.id,
    type: report.isCreditNote ? 'credit_note' : 'sale',
    status: report.status as V1SaleStatus,
    traderInvoiceNumber: report.traderInvoiceNumber,
    saleDate: toIsoDate(report.date),
    paymentTypeCode: report.paymentTypeCode,
    customer: {
      name: report.customerName,
      pin: report.customerTin,
      phone: report.customerPhoneNumber,
      email: report.customerEmail,
    },
    lines: report.itemList.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      name: line.itemName,
      description: line.itemDescription,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountRate: line.discountRate,
      discountAmount: line.discountAmount,
      total: line.totalAmount,
      taxableAmount: line.taxableAmount,
      taxAmount: line.taxAmount,
      taxRate: line.taxRate,
      taxTypeCode: line.taxTypeCode,
    })),
    totals: {
      total: report.itemList.reduce((sum, l) => sum + l.totalAmount, 0),
      taxableAmount: report.itemList.reduce(
        (sum, l) => sum + l.taxableAmount,
        0,
      ),
      taxAmount: report.itemList.reduce((sum, l) => sum + l.taxAmount, 0),
    },
    // Only once KRA has signed it: before that there is nothing to print, and
    // a half-populated receipt object invites a client to print it.
    receipt: accepted
      ? {
          cuInvoiceNo: report.cuInvoiceNo,
          receiptNumber: report.receiptNumber,
          receiptLabel: report.receiptLabel,
          scuId: report.scuId,
          scuDate: report.scuDate,
          scuTime: report.scuTime,
          totalReceiptCounter: report.totRcptNo,
          signature: report.receiptSignature,
          internalData: report.internalData,
          verificationUrl: report.etimsUrl,
          originalCuInvoiceNo: report.originalCuInvoiceNo,
        }
      : null,
    originalSaleId: report.originalSaleId,
    error: report.status === 'failed' ? report.syncErrorMessage : null,
  };
}

export type V1Sale = ReturnType<typeof toV1Sale>;

export function toV1Item(item: CatalogItem) {
  return {
    id: item.id,
    externalId: item.externalId,
    name: item.name,
    sku: item.sku,
    taxCategory: item.taxCategory,
    taxTypeCode: item.taxTyCd,
    productTypeCode: item.productTypeCode,
    classificationCode: item.classificationCode || null,
    unitCode: item.unitCode || null,
    packagingUnitCode: item.packagingUnitCode || null,
    // The default price (OSCU dftPrc). Accepted on write, so it is returned on read.
    unitPrice: item.unitPrice ?? null,
    stockTracked: item.isStockItem,
    registrationStatus: item.registrationStatus,
    // Why an item is not yet sellable, so a developer isn't left guessing why
    // a register call did nothing.
    needs: {
      productType: item.needsProductType,
      classificationMapping: item.needsClassificationMapping,
    },
  };
}

export type V1Item = ReturnType<typeof toV1Item>;

/** The report carries the receipt's `dd/mm/yyyy`; an API returns ISO `YYYY-MM-DD`. */
function toIsoDate(ddMmYyyy: string | null): string | null {
  if (!ddMmYyyy) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddMmYyyy);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : ddMmYyyy;
}

/**
 * A supplier invoice KRA has on record for this business (eTIMS purchase
 * data). Built from an allow-list like every `/v1` view: the dashboard's own
 * DTO also carries ERP sync state, its internal supplier link and the raw KRA
 * record's device metadata, none of which are part of this contract.
 */
export function toV1Purchase(p: PurchaseInvoiceDto) {
  return {
    id: p.id,
    status: p.confirmationStatus,
    supplier: { name: p.supplierName, pin: p.supplierPin },
    supplierInvoiceNumber: p.receiptNo,
    invoiceDate: p.invoiceDate.slice(0, 10),
    branch: p.branch,
    totals: { subtotal: p.subtotal, vat: p.vat, total: p.total },
    lines: p.lineItems.map((l) => ({
      description: l.description,
      hsCode: l.hsCode || null,
      quantity: l.qty,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      taxAmount: l.taxAmount,
      total: l.total,
    })),
    // Why the last attempt to confirm this invoice to KRA failed, if it did.
    confirmationError: p.kraConfirmError,
  };
}
