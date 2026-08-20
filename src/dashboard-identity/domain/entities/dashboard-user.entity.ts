import type { DashboardRole } from '../../../shared/domain/enums/dashboard-role.enum';

/**
 * Mode B (Compliance Dashboard) user — human login, scoped to one
 * DashboardOrganization (which may own multiple ComplianceTenant
 * "businesses" — see dashboard-organization). Not to be confused with the
 * main Sync2Books API's own User (Mode A does not use this).
 */
export type DashboardUserStatus = 'active' | 'deactivated';

export type DashboardOAuthProvider = 'google' | 'microsoft';

export interface DashboardUser {
  id: string;
  email: string;
  /** Null for OAuth-only accounts (Google/Microsoft) -- see [[oauthProvider]]. Password login must check for null, not assume every user has one. */
  passwordHash: string | null;
  displayName: string | null;
  role: DashboardRole;
  organizationId: string;
  status: DashboardUserStatus;
  /** Set once this user has signed in via Google/Microsoft at least once. A user can have a passwordHash *and* an oauthProvider if a password account later links an OAuth identity by verified email. */
  oauthProvider: DashboardOAuthProvider | null;
  /** The provider's stable subject/user id (e.g. Google `sub`) -- never the email, which can change at the IdP. */
  oauthSubject: string | null;
  createdAt: Date;
  updatedAt: Date;
}
