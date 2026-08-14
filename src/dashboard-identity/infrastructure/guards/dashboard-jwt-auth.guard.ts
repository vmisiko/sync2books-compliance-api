import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { DashboardRequestUser } from '../strategies/dashboard-jwt.strategy';

/**
 * Mode B guard. Populates `req.user: DashboardRequestUser`. Dashboard
 * controllers must read `req.user.tenantId` for data scoping — never trust a
 * client-supplied tenantId/branchId, unlike Mode A's ComplianceServiceAuthGuard
 * which trusts an already-validated caller.
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
