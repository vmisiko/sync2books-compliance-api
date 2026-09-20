import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';
import type { DashboardRequestUser } from '../strategies/dashboard-jwt.strategy';

/** `merchantId` as dashboard routes carry it: path param, query string, or body. */
function extractMerchantId(req: Request): string | null {
  const raw =
    (req.params as Record<string, unknown> | undefined)?.merchantId ??
    (req.query as Record<string, unknown> | undefined)?.merchantId ??
    (req.body as Record<string, unknown> | undefined)?.merchantId;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Ownership check for dashboard routes that take `merchantId` from the request
 * instead of the `x-tenant-id` header. A dashboard JWT proves which *organization*
 * the caller belongs to, never which business they may act for, so without this a
 * signed-in user of any organization could list or create documents for any
 * merchantId — the gap the comments on DashboardSalesController and friends
 * describe.
 *
 * `merchantId` here is `compliance_tenants.sync2booksCompanyId` (the main API
 * Company id), with tenants created outside that flow falling back to their own
 * id — `getTenantBySync2booksCompanyId` resolves both. Routes carrying no
 * merchantId are left to ActiveTenantGuard or to resource-id scoping.
 */
@Injectable()
export class MerchantOwnershipGuard implements CanActivate {
  constructor(
    private readonly organizations: ComplianceOrganizationApplicationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: DashboardRequestUser }>();

    const merchantId = extractMerchantId(req);
    if (merchantId === null) return true;

    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Missing organization context');
    }

    // Tenants provisioned through main API carry sync2booksCompanyId; a
    // compliance-only business (no ERP link) is addressed by its own id.
    const tenant =
      (await this.organizations.getTenantBySync2booksCompanyId(merchantId)) ??
      (await this.organizations.getTenantById(merchantId));
    if (!tenant) {
      throw new NotFoundException(`Business ${merchantId} not found`);
    }
    // A tenant with no organization was created through the service-to-service
    // path and is owned by nobody in dashboard terms: refuse rather than leak it
    // to whoever asks first.
    if (
      tenant.organizationId == null ||
      tenant.organizationId !== organizationId
    ) {
      throw new ForbiddenException(
        'This business does not belong to your organization',
      );
    }

    return true;
  }
}
