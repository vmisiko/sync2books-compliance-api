import { SetMetadata } from '@nestjs/common';
import type { ApiKeyScope } from '../../domain/api-key-scope.enum';

export const REQUIRED_SCOPES = 'compliance:required-scopes';

/**
 * Declares the scopes a route needs. Enforced centrally by
 * ComplianceApiKeyGuard, so a new route cannot forget to check — a route with
 * no decorator is readable-by-any-valid-key, which is why every `/v1` route
 * carries one.
 */
export const RequireScopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(REQUIRED_SCOPES, scopes);
