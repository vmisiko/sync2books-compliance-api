import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';
import type { DashboardRequestUser } from '../strategies/dashboard-jwt.strategy';

export const ACTIVE_TENANT_HEADER = 'x-tenant-id';

/**
 * Resolves and verifies the business a dashboard request operates on. A
 * DashboardUser's JWT only carries an organizationId (an org can own many
 * businesses) — every request that touches business-scoped data must name
 * which one via the `x-tenant-id` header, and this guard confirms that
 * tenant actually belongs to the caller's organization before attaching it
 * to `req` as `activeTenantId`. Must run after DashboardJwtAuthGuard.
 */
@Injectable()
export class ActiveTenantGuard implements CanActivate {
  constructor(
    private readonly organizations: ComplianceOrganizationApplicationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      Request & { user?: DashboardRequestUser; activeTenantId?: string }
    >();

    const tenantId = req.header(ACTIVE_TENANT_HEADER);
    if (!tenantId) {
      throw new BadRequestException(
        `Missing required ${ACTIVE_TENANT_HEADER} header`,
      );
    }

    const tenant = await this.organizations.getTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundException(`Business ${tenantId} not found`);
    }
    if (tenant.organizationId !== req.user?.organizationId) {
      throw new ForbiddenException(
        'This business does not belong to your organization',
      );
    }

    req.activeTenantId = tenantId;
    return true;
  }
}
