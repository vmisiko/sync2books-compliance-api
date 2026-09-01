import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { dashboardJwtSecret } from '../dashboard-jwt.secret';
import { DASHBOARD_USER_REPO } from '../../../shared/tokens';
import type { IDashboardUserRepository } from '../../application/ports/dashboard-user.repository.port';

export interface DashboardJwtPayload {
  sub: string;
  email: string;
  role: string;
  organizationId: string;
}

export interface DashboardRequestUser {
  userId: string;
  email: string;
  role: string;
  organizationId: string;
}

/**
 * Mode B only — verifies Compliance-issued dashboard session tokens.
 * Named 'dashboard-jwt' (not the default 'jwt') so it can never be picked up
 * by an unrelated AuthGuard('jwt') if one is added for another purpose later.
 */
@Injectable()
export class DashboardJwtStrategy extends PassportStrategy(
  Strategy,
  'dashboard-jwt',
) {
  constructor(
    @Inject(DASHBOARD_USER_REPO)
    private readonly users: IDashboardUserRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: dashboardJwtSecret(),
    });
  }

  /**
   * Re-checks the user's current status on every request rather than
   * trusting the token's claims -- otherwise deactivating someone wouldn't
   * take effect until their up-to-1h access token happened to expire.
   */
  async validate(payload: DashboardJwtPayload): Promise<DashboardRequestUser> {
    const user = await this.users.findById(payload.sub);
    if (!user || user.status === 'deactivated') {
      throw new UnauthorizedException('This account has been deactivated');
    }

    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      organizationId: payload.organizationId,
    };
  }
}
