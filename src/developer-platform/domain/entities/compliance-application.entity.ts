/**
 * A merchant organisation's integration app — the thing API keys belong to.
 * Owned by a DashboardOrganization, never by the provider: this is what makes
 * the compliance platform self-serve rather than lending out a provider
 * credential that can see other organisations' data.
 */
export type ComplianceApplicationStatus = 'active' | 'suspended';

export interface ComplianceApplication {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: ComplianceApplicationStatus;
  /** Requests per minute allowed across all of this application's keys. */
  rateLimitPerMin: number;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
