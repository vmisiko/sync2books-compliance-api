/**
 * Branch under a compliance tenant (maps to Sync2Books branch / location).
 */
export interface ComplianceBranch {
  id: string;
  tenantId: string;
  /** Set when this branch is linked to a Sync2Books / ERP branch id; null for compliance-dashboard-only provisioning. */
  sync2booksBranchId: string | null;
  displayName: string | null;
  /** KRA/OSCU branch id (`bhfId`) when known */
  kraBhfId: string | null;
  /** Trade address line for the receipt header (TIS page 8 "Shop address"). */
  tradeAddressLine1: string | null;
  /** Trade city for the receipt header. */
  tradeCity: string | null;
  createdAt: Date;
  updatedAt: Date;
}
