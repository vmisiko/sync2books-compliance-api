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
  /**
   * OSCU `invcNo` -- a real, persistent, strictly-incrementing-from-1 sequence per
   * (kraPin, environment). NOT derived from documentNumber text (KRA rejects a
   * mismatched value with "Invalid invcNo sequence, expected: N but found: M",
   * confirmed live 2026-08-11). Falls back to 1 if unset (should not happen once
   * submit-document.usecase.ts allocates it).
   */
  invoiceSequence: number;
  /** For CREDIT_NOTE: the original sale's `invoiceSequence` (its OSCU invcNo). */
  originalInvoiceSequence?: number;
  /** Sales metadata */
  saleDate?: string;
  receiptTypeCode?: string;
  paymentTypeCode?: string;
  invoiceStatusCode?: string;
  /** For CREDIT_NOTE: original sale's trader invoice number */
  originalDocumentNumber?: string;
  /** For CREDIT_NOTE: credit note datetime (OSCU `rfdDt`) `yyyyMMddhhmmss` */
  creditNoteDate?: string;
  /** For CREDIT_NOTE: credit reason code (OSCU `rfdRsnCd`) e.g. "01".."06" */
  creditNoteReasonCode?: string;
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
  customerName?: string;
  /** OSCU `salesTyCd` (default `N`). */
  salesTypeCode?: string;
  /** Root-level `prchrAcptcYn` (default `N`). */
  purchaseAcceptanceYn?: 'Y' | 'N';
  /** Lines */
  lines: EtimsInvoiceLine[];
}
