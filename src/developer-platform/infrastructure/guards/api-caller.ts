import type { Request } from 'express';
import type { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import type { ApiKeyScope } from '../../domain/api-key-scope.enum';

/**
 * What an authenticated API key establishes. Everything downstream scopes off
 * this and never off anything the caller sent: the organisation decides which
 * businesses are reachable, the environment decides whether those businesses
 * may be live ones, and the scopes decide which operations are allowed.
 */
export type ApiCaller = {
  apiKeyId: string;
  applicationId: string;
  organizationId: string;
  environment: ConnectionEnvironment;
  scopes: ApiKeyScope[];
  rateLimitPerMin: number;
};

export type ApiKeyRequest = Request & {
  apiCaller?: ApiCaller;
  /** Set by TenantScopeGuard once the target business is resolved and allowed. */
  apiTenantId?: string;
};
