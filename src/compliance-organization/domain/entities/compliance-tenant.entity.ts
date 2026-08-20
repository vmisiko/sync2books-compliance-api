/**
 * Compliance-side tenant (maps 1:1 to a Sync2Books company / business).
 */
export interface ComplianceTenant {
  id: string;
  sync2booksCompanyId: string | null;
  displayName: string | null;
  /** Owning DashboardOrganization ("business" belongs to an org) — null for tenants created via the main-API service-to-service path, which predates this concept. */
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
