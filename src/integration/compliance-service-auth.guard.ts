import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';

/**
 * Sync2Books → Compliance M2M protection. When `COMPLIANCE_SERVICE_TOKEN` is set
 * (recommended in shared environments), requires a matching Bearer token plus
 * `x-sync2books-company-id`. Leave the env unset locally to skip enforcement.
 */
@Injectable()
export class ComplianceServiceAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected =
      typeof process.env.COMPLIANCE_SERVICE_TOKEN === 'string'
        ? process.env.COMPLIANCE_SERVICE_TOKEN.trim()
        : '';
    if (!expected) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const authHeader =
      typeof req.headers.authorization === 'string'
        ? req.headers.authorization.trim()
        : '';

    let bearer = '';
    if (authHeader.length > 0) {
      if (authHeader.toLowerCase().startsWith('bearer ')) {
        bearer = authHeader.slice(7).trim();
      } else {
        bearer = authHeader;
      }
    }

    try {
      const a = Buffer.from(bearer, 'utf8');
      const b = Buffer.from(expected, 'utf8');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new UnauthorizedException(
          'Invalid or missing service credentials',
        );
      }
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Invalid or missing service credentials');
    }

    const companyRaw = req.headers['x-sync2books-company-id'];
    const companyId = typeof companyRaw === 'string' ? companyRaw.trim() : '';
    if (!companyId) {
      throw new BadRequestException('Missing x-sync2books-company-id header');
    }

    return true;
  }
}
