import type { DashboardRole } from '../../../shared/domain/enums/dashboard-role.enum';

/**
 * Mode B (Compliance Dashboard) user — human login, scoped to one ComplianceTenant.
 * Not to be confused with the main Sync2Books API's own User (Mode A does not use this).
 */
export interface DashboardUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  role: DashboardRole;
  complianceTenantId: string;
  createdAt: Date;
  updatedAt: Date;
}
