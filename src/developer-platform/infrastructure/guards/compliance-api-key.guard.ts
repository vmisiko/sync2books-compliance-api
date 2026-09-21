import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  COMPLIANCE_API_KEY_REPO,
  COMPLIANCE_APPLICATION_REPO,
} from '../../../shared/tokens';
import type { IComplianceApiKeyRepository } from '../../application/ports/compliance-api-key.repository.port';
import type { IComplianceApplicationRepository } from '../../application/ports/compliance-application.repository.port';
import {
  API_KEY_HEADER,
  apiKeyHashesEqual,
  hashApiKey,
  looksLikeApiKey,
} from '../../domain/api-key';
import type { ApiKeyScope } from '../../domain/api-key-scope.enum';
import { REQUIRED_SCOPES } from '../decorators/require-scopes.decorator';
import type { ApiKeyRequest } from './api-caller';

/**
 * Authenticates a merchant's own integration key on the public API.
 *
 * Deliberately says only "Invalid API key" for every failure below — wrong key,
 * revoked key, expired key, suspended application. Distinguishing them tells an
 * attacker holding a leaked string whether it was ever real, which is worth
 * more to them than it is to a developer who can see their own keys listed in
 * the dashboard.
 *
 * This guard establishes *who* is calling. It does not establish *which
 * business they may act for* — that is TenantScopeGuard, and a route that takes
 * a business must carry both.
 */
@Injectable()
export class ComplianceApiKeyGuard implements CanActivate {
  constructor(
    @Inject(COMPLIANCE_API_KEY_REPO)
    private readonly keys: IComplianceApiKeyRepository,
    @Inject(COMPLIANCE_APPLICATION_REPO)
    private readonly applications: IComplianceApplicationRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiKeyRequest>();
    const presented = readApiKey(req);

    if (!presented || !looksLikeApiKey(presented)) {
      throw new UnauthorizedException('Invalid API key');
    }

    const record = await this.keys.findByHash(hashApiKey(presented));
    // findByHash already matched on the digest; the explicit compare keeps the
    // constant-time property if that lookup is ever replaced by a scan.
    if (!record || !apiKeyHashesEqual(record.keyHash, hashApiKey(presented))) {
      throw new UnauthorizedException('Invalid API key');
    }
    if (record.status !== 'active') {
      throw new UnauthorizedException('Invalid API key');
    }
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid API key');
    }

    const application = await this.applications.findById(record.applicationId);
    if (!application || application.status !== 'active') {
      throw new UnauthorizedException('Invalid API key');
    }

    const required = this.reflector.getAllAndOverride<ApiKeyScope[]>(
      REQUIRED_SCOPES,
      [context.getHandler(), context.getClass()],
    );
    const missing = (required ?? []).filter(
      (scope) => !record.scopes.includes(scope),
    );
    if (missing.length > 0) {
      throw new ForbiddenException(
        `This API key is missing the ${missing.join(', ')} scope${
          missing.length > 1 ? 's' : ''
        }`,
      );
    }

    req.apiCaller = {
      apiKeyId: record.id,
      applicationId: application.id,
      organizationId: application.organizationId,
      environment: record.environment,
      scopes: record.scopes,
      rateLimitPerMin: application.rateLimitPerMin,
    };

    // Best-effort: a failed touch must not fail a request the caller was
    // entitled to make.
    void this.keys.touchLastUsedAt(record.id, new Date()).catch(() => undefined);

    return true;
  }
}

/**
 * `x-api-key`, or `Authorization: Bearer cmp_sk_…` for clients whose HTTP
 * library makes custom headers awkward. A bearer token that isn't one of our
 * keys is left alone so it still reads as "invalid key" rather than colliding
 * with the dashboard's own tokens.
 */
function readApiKey(req: ApiKeyRequest): string | null {
  const header = req.header(API_KEY_HEADER);
  if (typeof header === 'string' && header.trim() !== '') return header.trim();

  const authorization = req.header('authorization');
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (match && looksLikeApiKey(match[1])) return match[1];
  }
  return null;
}
