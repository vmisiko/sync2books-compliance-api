/**
 * One signed-up dashboard account's organisation — owns zero or more
 * ComplianceTenant "businesses" (see compliance-organization). Every business
 * shares the one Main API Application configured via
 * MAIN_API_APPLICATION_ID/MAIN_API_API_KEY (see getGlobalMainApiCredentials),
 * not a per-organization one.
 */
export interface DashboardOrganization {
  id: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}
