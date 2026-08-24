export enum SourceSystem {
  QUICKBOOKS = 'QUICKBOOKS',
  XERO = 'XERO',
  SAGE = 'SAGE',
  ODOO = 'ODOO',
  MICROSOFT_DYNAMICS_365_BUSINESS_CENTRAL = 'MICROSOFT_DYNAMICS_365_BUSINESS_CENTRAL',
  API = 'API',
  /**
   * A mapping (or other record) entered directly by a dashboard user, not
   * derived from any pulled ERP data. Deliberately distinct from API: API
   * means "arrived via the main-API pull integration, but main API hadn't
   * standardized that row's ERP yet" (see DashboardInvoicesApplicationService,
   * which now prefers the pulled invoice's real standardized.sourceSystem —
   * QUICKBOOKS/ODOO/etc. — and only falls back to this generic API tag when
   * that's unavailable) — MANUAL means "a human typed this into the
   * mapping-review dashboard," which is a different provenance the UI needs
   * to tell apart (e.g. it never carries a confidenceScore).
   */
  MANUAL = 'MANUAL',
}
