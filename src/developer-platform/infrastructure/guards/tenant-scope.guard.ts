import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import type { ApiKeyRequest } from './api-caller';

/**
 * The one place a public API request is bound to a business.
 *
 * An API key proves which organisation is calling; it never proves which
 * business the caller may act for. Checking that per handler is how the
 * dashboard routes ended up with holes, so every `/v1` route that names a
 * business goes through here instead, and a new route inherits the check by
 * being mounted rather than by remembering to call something.
 *
 * Two independent refusals:
 *  - **Ownership** — the business must belong to the key's organisation.
 *  - **Environment** — a SANDBOX key may only touch SANDBOX businesses and a
 *    PRODUCTION key only PRODUCTION ones. This is the rail that stops a test
 *    integration filing real tax data with KRA, which is not an error anyone
 *    can take back.
 *
 * Both are stated as 403 with a specific message: unlike an invalid key, the
 * caller here is authenticated and the fix is theirs to make.
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  constructor(
    private readonly organizations: ComplianceOrganizationApplicationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiKeyRequest>();

    const caller = req.apiCaller;
    if (!caller) {
      // Mounting TenantScopeGuard without ComplianceApiKeyGuard in front of it
      // is a wiring mistake, and failing open would make it an invisible one.
      throw new ForbiddenException('Missing API caller context');
    }

    const businessId = extractBusinessId(req);
    if (businessId === null) return true;

    // Businesses provisioned through the accounting-platform path carry a
    // sync2booksCompanyId; a compliance-only business is addressed by its own
    // id. getTenantByMerchantId resolves either form.
    const tenant = await this.organizations.getTenantByMerchantId(businessId);
    // 404 rather than 403: a business id that exists in no organisation at all
    // reveals nothing, and telling the caller "not found" is the truthful
    // answer for a typo, which is the common case.
    if (!tenant) {
      throw new NotFoundException(`Business ${businessId} not found`);
    }

    if (
      tenant.organizationId == null ||
      tenant.organizationId !== caller.organizationId
    ) {
      throw new ForbiddenException(
        'This business does not belong to your organization',
      );
    }

    const environment = await this.organizations.getTenantEnvironment(
      tenant.id,
    );
    if (environment === null) {
      throw new ForbiddenException(
        'This business has no eTIMS connection yet. Complete its setup in the compliance dashboard before calling the API for it.',
      );
    }
    if (environment !== caller.environment) {
      throw new ForbiddenException(
        `This is a ${describeKey(caller.environment)} API key and ${
          tenant.displayName ?? 'that business'
        } is a ${describeBusiness(environment)} business. Use the key for that environment.`,
      );
    }

    req.apiTenantId = tenant.id;
    return true;
  }
}

/** The business, however a route names it: path param, query string, or body. */
function extractBusinessId(req: ApiKeyRequest): string | null {
  const params = req.params as Record<string, unknown> | undefined;
  const query = req.query as Record<string, unknown> | undefined;
  const body = req.body as Record<string, unknown> | undefined;

  const raw =
    params?.businessId ??
    params?.merchantId ??
    query?.businessId ??
    query?.merchantId ??
    body?.businessId ??
    body?.merchantId;

  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function describeKey(environment: ConnectionEnvironment): string {
  return environment === ConnectionEnvironment.PRODUCTION ? 'live' : 'test';
}

function describeBusiness(environment: ConnectionEnvironment): string {
  return environment === ConnectionEnvironment.PRODUCTION
    ? 'production'
    : 'sandbox';
}
