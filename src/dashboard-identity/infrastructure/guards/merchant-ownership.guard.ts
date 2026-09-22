import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';
import type { DashboardRequestUser } from '../strategies/dashboard-jwt.strategy';
import { MERCHANT_ID_OPTIONAL } from './merchant-id-optional.decorator';
import {
  findTenantForMerchant,
  tenantBelongsToOrganization,
} from './merchant-tenant';

/**
 * Every `merchantId` the request carries, from path params, query string and
 * body -- all of them, not the first. Handlers read whichever source they
 * declare (`@Query`, `@Body`), so checking one source while the handler reads
 * another lets a caller pair an owned id in one place with a foreign id in the
 * other. A value that is not a plain string (`?merchantId=a&merchantId=b`,
 * `merchantId[x]=y`, a JSON object) is refused: it would sail past a typeof
 * check as "absent" and reach the handler as something else.
 */
function extractMerchantIds(req: Request): string[] {
  const found = new Set<string>();
  for (const source of [req.params, req.query, req.body]) {
    if (source === null || typeof source !== 'object') continue;
    const raw = (source as Record<string, unknown>).merchantId;
    if (raw === undefined) continue;
    if (typeof raw !== 'string') {
      throw new BadRequestException('merchantId must be a single string');
    }
    if (raw.trim() !== '') found.add(raw);
  }
  return [...found];
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
 * id — `findTenantForMerchant` resolves both.
 *
 * A request naming no merchantId is refused (400) unless the route is marked
 * `@MerchantIdOptional()` because something else scopes it (ActiveTenantGuard,
 * or SaleOwnershipGuard for by-id routes). It used to be waved through, and on
 * `PATCH customers/:id` that let a caller drop `merchantId` altogether: TypeORM
 * skips an `undefined` where-key, so the row was found by bare id whatever
 * organization owned it.
 */
@Injectable()
export class MerchantOwnershipGuard implements CanActivate {
  constructor(
    private readonly organizations: ComplianceOrganizationApplicationService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: DashboardRequestUser }>();

    const merchantIds = extractMerchantIds(req);
    if (merchantIds.length === 0) {
      const optional = this.reflector.getAllAndOverride<boolean | undefined>(
        MERCHANT_ID_OPTIONAL,
        [context.getHandler(), context.getClass()],
      );
      if (optional) return true;
      throw new BadRequestException('merchantId is required');
    }

    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Missing organization context');
    }

    for (const merchantId of merchantIds) {
      const tenant = await findTenantForMerchant(
        this.organizations,
        merchantId,
      );
      if (!tenant) {
        throw new NotFoundException(`Business ${merchantId} not found`);
      }
      // A tenant with no organization was created through the service-to-service
      // path and is owned by nobody in dashboard terms: refuse rather than leak
      // it to whoever asks first.
      if (!tenantBelongsToOrganization(tenant, organizationId)) {
        throw new ForbiddenException(
          'This business does not belong to your organization',
        );
      }
    }

    return true;
  }
}
