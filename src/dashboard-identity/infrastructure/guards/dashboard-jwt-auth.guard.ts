import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { DashboardRequestUser } from '../strategies/dashboard-jwt.strategy';

/**
 * Mode B guard. Populates `req.user: DashboardRequestUser` (userId, role,
 * organizationId — no tenantId: a JWT no longer implies one fixed business).
 * Dashboard controllers that need to scope by business must additionally
 * apply ActiveTenantGuard and read `@ActiveTenant()`, which resolves and
 * verifies an `x-tenant-id` header against `req.user.organizationId` — never
 * trust a client-supplied tenant id without that check, unlike Mode A's
 * ComplianceServiceAuthGuard which trusts an already-validated caller.
 */
@Injectable()
export class DashboardJwtAuthGuard extends AuthGuard('dashboard-jwt') {
  handleRequest<TUser = DashboardRequestUser>(
    err: unknown,
    user: TUser,
  ): TUser {
    if (err || !user) {
      throw err instanceof Error
        ? err
        : new UnauthorizedException('Access token is required');
    }
    return user;
  }
}
