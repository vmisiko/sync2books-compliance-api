/**
 * eTIMS/OSCU payload types - transport layer only.
 * The compliance model sits in between ERP and this.
 */

export interface EtimsInvoiceLine {
  itemCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxAmount: number;
  classificationCode: string;
  /** OSCU qtyUnitCd */
  unitCode: string;
  /** OSCU pkgUnitCd */
  packagingUnitCode: string;
  /** OSCU taxTyCd */
  taxTyCd: string;
  /** OSCU itemTyCd */
  productTypeCode: string;
}

export interface EtimsInvoicePayload {
  /** Document reference */
  documentNumber: string;
  documentType: string;
  /** Sales metadata */
  saleDate?: string;
  receiptTypeCode?: string;
  paymentTypeCode?: string;
  invoiceStatusCode?: string;
  /** For CREDIT_NOTE: original sale's trader invoice number */
  originalDocumentNumber?: string;
  /** Branch/device for submission */
  branchId: string;
  deviceId: string;
  /** Amounts */
  currency: string;
  exchangeRate: number;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  /** Customer (B2B) */
  customerPin?: string;
  /** Lines */
  lines: EtimsInvoiceLine[];
}
