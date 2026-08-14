export enum TaxCategory {
  VAT_STANDARD = 'VAT_STANDARD',
  VAT_ZERO = 'VAT_ZERO',
  EXEMPT = 'EXEMPT',
  OTHER = 'OTHER',
  /** KRA taxTyCd 'E' — the dedicated 8% VAT rate (e.g. petroleum products), distinct from the 16% standard rate. */
  VAT_8 = 'VAT_8',
}
