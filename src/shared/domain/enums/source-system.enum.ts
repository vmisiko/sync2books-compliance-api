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
   * means "arrived via the main-API pull integration" (see
   * DashboardInvoicesApplicationService, which tags pulled sales with it even
   * though the ultimate source is QuickBooks) — MANUAL means "a human typed
   * this into the mapping-review dashboard," which is a different provenance
   * the UI needs to tell apart (e.g. it never carries a confidenceScore).
   */
  MANUAL = 'MANUAL',
}
