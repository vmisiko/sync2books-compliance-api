import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { dashboardJwtSecret } from '../dashboard-jwt.secret';

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
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: dashboardJwtSecret(),
    });
  }

  validate(payload: DashboardJwtPayload): DashboardRequestUser {
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      organizationId: payload.organizationId,
    };
  }
}
