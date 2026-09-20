import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ASSERTED_COMPANY_ID } from './compliance-service-auth.guard';

/** `merchantId` as it appears on service routes: path param, query string, or body. */
export function extractMerchantId(req: Request): string | null {
  const fromParams = (req.params as Record<string, unknown> | undefined)
    ?.merchantId;
  const fromQuery = (req.query as Record<string, unknown> | undefined)
    ?.merchantId;
  const fromBody = (req.body as Record<string, unknown> | undefined)?.merchantId;
  const raw = fromParams ?? fromQuery ?? fromBody;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Binds the merchant named in the payload to the one the caller asserted in
 * `x-sync2books-company-id`. Without this, the service token is a master key:
 * it authenticates *that main API is calling*, never *which tenant it may act
 * for*, so any merchantId in the body would reach that tenant's KRA device
 * credentials. Main API already forces the two to agree on its own side
 * (`EtimsOperationalService.coerceMerchant`); this is the matching check here.
 *
 * Runs after {@link ComplianceServiceAuthGuard}. When that guard is in its
 * unauthenticated local-dev mode nothing is asserted, so there is nothing to
 * compare and this guard stands aside.
 */
@Injectable()
export class AssertedMerchantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & Record<string, unknown>>();

    const asserted = req[ASSERTED_COMPANY_ID];
    if (typeof asserted !== 'string' || asserted === '') return true;

    const merchantId = extractMerchantId(req);
    // Routes that carry no merchantId (e.g. document-id lookups) are scoped by
    // the resource itself; this guard only adjudicates the ones that do.
    if (merchantId === null) return true;

    if (merchantId !== asserted) {
      throw new ForbiddenException(
        'merchantId does not match the authenticated company',
      );
    }

    return true;
  }
}
