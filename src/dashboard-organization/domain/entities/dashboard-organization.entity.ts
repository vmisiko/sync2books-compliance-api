/**
 * One signed-up dashboard account's organisation — owns zero or more
 * ComplianceTenant "businesses" (see compliance-organization) and shares one
 * main-API Application/apiKey across all of them.
 */
export interface DashboardOrganization {
  id: string;
  displayName: string;
  /** Main API (nest-sync-2-books-api) Organization.id, from POST auth/signup. Null for dev-seeded orgs that never called the main API. */
  mainApiOrganizationId: string | null;
  /** Main API Application.id, from POST organizations/:id/applications. */
  mainApiApplicationId: string | null;
  /** Main API Application's production apiKey — reused for every business (Company) created under this org. */
  mainApiApiKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}
