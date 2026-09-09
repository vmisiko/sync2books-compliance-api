/**
 * Compliance-side tenant (maps 1:1 to a Sync2Books company / business).
 */
export interface ComplianceTenant {
  id: string;
  sync2booksCompanyId: string | null;
  displayName: string | null;
  /** Owning DashboardOrganization ("business" belongs to an org) — null for tenants created via the main-API service-to-service path, which predates this concept. */
  organizationId: string | null;
  /** Commercial message above the item list on a receipt (TIS page 8 sample: "Welcome to our shop"). Null falls back to a generic default at render time. */
  receiptHeaderMessage: string | null;
  /** Commercial message in a receipt's footer (TIS page 8 sample: "THANK YOU ..."). Null falls back to a generic default at render time. */
  receiptFooterMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}
