import type { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import type { ApiKeyScope } from '../api-key-scope.enum';

export type ComplianceApiKeyStatus = 'active' | 'revoked';

/**
 * A stored API key. The secret itself is never here — only its SHA-256 hash,
 * so a leaked database row cannot be replayed against the API.
 *
 * `environment` is the guard rail that stops a developer filing real tax data
 * from a test integration: a SANDBOX key may only act on businesses whose
 * eTIMS connection is SANDBOX, and a PRODUCTION key only on PRODUCTION ones.
 */
export interface ComplianceApiKey {
  id: string;
  applicationId: string;
  environment: ConnectionEnvironment;
  /** Human-recognisable head of the key, e.g. `cmp_sk_test_8f2a`. Safe to display. */
  keyPrefix: string;
  keyHash: string;
  lastFour: string;
  name: string | null;
  scopes: ApiKeyScope[];
  status: ComplianceApiKeyStatus;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdByUserId: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
