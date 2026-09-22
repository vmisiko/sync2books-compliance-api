import type { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';

type TenantLookup = Pick<
  ComplianceOrganizationApplicationService,
  'getTenantBySync2booksCompanyId' | 'getTenantById'
>;

/**
 * Resolves the business a `merchantId` names. Tenants provisioned through the
 * main API carry `sync2booksCompanyId`; a compliance-only business (no ERP
 * link) is addressed by its own id. Shared by every dashboard check that turns
 * a merchantId into an owner, so they cannot disagree about which tenant it is.
 */
export async function findTenantForMerchant(
  organizations: TenantLookup,
  merchantId: string,
) {
  return (
    (await organizations.getTenantBySync2booksCompanyId(merchantId)) ??
    (await organizations.getTenantById(merchantId))
  );
}

/**
 * True only when the tenant is owned by exactly this organization. A tenant
 * with no organization was created through the service-to-service path and is
 * owned by nobody in dashboard terms, so it matches no caller.
 */
export function tenantBelongsToOrganization(
  tenant: { organizationId: string | null } | null | undefined,
  organizationId: string,
): boolean {
  return tenant != null && tenant.organizationId === organizationId;
}
