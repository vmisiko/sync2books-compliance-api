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
  createdAt: Date;
  updatedAt: Date;
}
