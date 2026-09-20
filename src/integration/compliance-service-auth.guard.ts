import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';

/** Set by this guard so downstream guards can bind the payload's merchant to the caller's assertion. */
export const ASSERTED_COMPANY_ID = 'sync2booksAssertedCompanyId';

/**
 * Sync2Books → Compliance M2M protection. Requires a matching Bearer token plus
 * `x-sync2books-company-id`, and records that company id on the request so
 * {@link AssertedMerchantGuard} can reject a payload naming a different merchant.
 *
 * `COMPLIANCE_SERVICE_TOKEN` unset is tolerated **only** outside production, and
 * only with a loud warning: these routes reach a tenant's KRA device credentials,
 * so an unset token in a shared environment is an open door, not a convenience.
 */
@Injectable()
export class ComplianceServiceAuthGuard implements CanActivate {
  private readonly logger = new Logger(ComplianceServiceAuthGuard.name);
  private warned = false;

  canActivate(context: ExecutionContext): boolean {
    const expected =
      typeof process.env.COMPLIANCE_SERVICE_TOKEN === 'string'
        ? process.env.COMPLIANCE_SERVICE_TOKEN.trim()
        : '';

    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'COMPLIANCE_SERVICE_TOKEN is not set — refusing service-to-service requests.',
        );
        throw new UnauthorizedException(
          'Service authentication is not configured',
        );
      }
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          'COMPLIANCE_SERVICE_TOKEN is not set — service routes are UNAUTHENTICATED. Local development only.',
        );
      }
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

    (req as Request & Record<string, unknown>)[ASSERTED_COMPANY_ID] = companyId;

    return true;
  }
}
