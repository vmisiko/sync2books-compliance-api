import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { DashboardRole } from '../../../shared/domain/enums/dashboard-role.enum';
import { DASHBOARD_USER_REPO } from '../../../shared/tokens';
import type { IDashboardUserRepository } from '../../application/ports/dashboard-user.repository.port';
import type { DashboardRequestUser } from '../strategies/dashboard-jwt.strategy';

/**
 * Admin-only dashboard routes. Mount after `DashboardJwtAuthGuard`.
 *
 * The role is re-read from the user row rather than taken from the JWT: the
 * token carries the role it was signed with, so an admin who is demoted or
 * deactivated would otherwise keep admin powers until the token expires --
 * and the routes behind this guard mint credentials that outlive the session.
 */
@Injectable()
export class DashboardAdminGuard implements CanActivate {
  constructor(
    @Inject(DASHBOARD_USER_REPO)
    private readonly users: IDashboardUserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: DashboardRequestUser }>();
    const caller = req.user;
    if (!caller?.userId) {
      throw new ForbiddenException('Missing user context');
    }

    const user = await this.users.findById(caller.userId);
    if (
      !user ||
      user.status !== 'active' ||
      user.organizationId !== caller.organizationId ||
      user.role !== DashboardRole.ADMIN
    ) {
      throw new ForbiddenException('Only an organisation admin can do this.');
    }
    return true;
  }
}
