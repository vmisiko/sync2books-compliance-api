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
  unitCode: string;
}

export interface EtimsInvoicePayload {
  /** Document reference */
  documentNumber: string;
  documentType: string;
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
