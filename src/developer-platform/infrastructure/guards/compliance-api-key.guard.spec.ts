import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import type { IComplianceApiKeyRepository } from '../../application/ports/compliance-api-key.repository.port';
import type { IComplianceApplicationRepository } from '../../application/ports/compliance-application.repository.port';
import { generateApiKey, hashApiKey } from '../../domain/api-key';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import type { ComplianceApiKey } from '../../domain/entities/compliance-api-key.entity';
import type { ComplianceApplication } from '../../domain/entities/compliance-application.entity';
import type { ApiKeyRequest } from './api-caller';
import { ComplianceApiKeyGuard } from './compliance-api-key.guard';

const SECRET = generateApiKey(ConnectionEnvironment.SANDBOX);

function ctx(headers: Record<string, string>): {
  context: ExecutionContext;
  req: ApiKeyRequest;
} {
  const req = {
    headers,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as ApiKeyRequest;
  return {
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext,
    req,
  };
}

function apiKey(overrides: Partial<ComplianceApiKey> = {}): ComplianceApiKey {
  return {
    id: 'key-1',
    applicationId: 'app-1',
    environment: ConnectionEnvironment.SANDBOX,
    keyPrefix: SECRET.keyPrefix,
    keyHash: SECRET.keyHash,
    lastFour: SECRET.lastFour,
    name: 'Till 1',
    scopes: [ApiKeyScope.SALES_WRITE, ApiKeyScope.CATALOG_READ],
    status: 'active',
    lastUsedAt: null,
    expiresAt: null,
    createdByUserId: 'user-1',
    revokedAt: null,
    revokedByUserId: null,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    ...overrides,
  };
}

function application(
  overrides: Partial<ComplianceApplication> = {},
): ComplianceApplication {
  return {
    id: 'app-1',
    organizationId: 'org-1',
    name: 'Warehouse POS',
    description: null,
    status: 'active',
    rateLimitPerMin: 120,
    createdByUserId: 'user-1',
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    ...overrides,
  };
}

function guardFor(
  key: ComplianceApiKey | null,
  app: ComplianceApplication | null = application(),
  requiredScopes?: ApiKeyScope[],
): { guard: ComplianceApiKeyGuard; keys: IComplianceApiKeyRepository } {
  const keys = {
    findByHash: jest.fn(async (hash: string) =>
      key && key.keyHash === hash ? key : null,
    ),
    findById: jest.fn(),
    findByApplicationId: jest.fn(),
    save: jest.fn(),
    touchLastUsedAt: jest.fn(async () => undefined),
  } as unknown as IComplianceApiKeyRepository;

  const applications = {
    findById: jest.fn(async () => app),
    findByOrganizationId: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  } as unknown as IComplianceApplicationRepository;

  const reflector = {
    getAllAndOverride: jest.fn(() => requiredScopes),
  } as unknown as Reflector;

  return { guard: new ComplianceApiKeyGuard(keys, applications, reflector), keys };
}

describe('ComplianceApiKeyGuard', () => {
  it('authenticates a valid key and records the caller', async () => {
    const { guard } = guardFor(apiKey());
    const { context, req } = ctx({ 'x-api-key': SECRET.plaintext });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.apiCaller).toEqual({
      apiKeyId: 'key-1',
      applicationId: 'app-1',
      organizationId: 'org-1',
      environment: ConnectionEnvironment.SANDBOX,
      scopes: [ApiKeyScope.SALES_WRITE, ApiKeyScope.CATALOG_READ],
      rateLimitPerMin: 120,
    });
  });

  it('accepts the key as a bearer token, for clients that cannot set custom headers', async () => {
    const { guard } = guardFor(apiKey());
    const { context, req } = ctx({
      authorization: `Bearer ${SECRET.plaintext}`,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.apiCaller?.apiKeyId).toBe('key-1');
  });

  // A dashboard session token must not be mistaken for an API key, in either
  // direction -- they are different credentials with different scope rules.
  it('does not treat a dashboard JWT as an API key', async () => {
    const { guard } = guardFor(apiKey());
    const { context } = ctx({
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request with no key at all', async () => {
    const { guard } = guardFor(apiKey());
    await expect(guard.canActivate(ctx({}).context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('never reaches the database for a string that is not key-shaped', async () => {
    const { guard, keys } = guardFor(apiKey());
    const { context } = ctx({ 'x-api-key': 'not-a-key' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(keys.findByHash).not.toHaveBeenCalled();
  });

  it('rejects a well-formed key that was never issued', async () => {
    const { guard } = guardFor(null);
    const other = generateApiKey(ConnectionEnvironment.SANDBOX);
    const { context } = ctx({ 'x-api-key': other.plaintext });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a revoked key', async () => {
    const { guard } = guardFor(apiKey({ status: 'revoked' }));
    const { context } = ctx({ 'x-api-key': SECRET.plaintext });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired key', async () => {
    const { guard } = guardFor(
      apiKey({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const { context } = ctx({ 'x-api-key': SECRET.plaintext });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a key whose expiry has not passed', async () => {
    const { guard } = guardFor(
      apiKey({ expiresAt: new Date(Date.now() + 60_000) }),
    );
    const { context } = ctx({ 'x-api-key': SECRET.plaintext });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  // Suspending an application has to stop its keys working, or suspension is
  // only a label.
  it('rejects a valid key belonging to a suspended application', async () => {
    const { guard } = guardFor(apiKey(), application({ status: 'suspended' }));
    const { context } = ctx({ 'x-api-key': SECRET.plaintext });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a key whose application has been deleted', async () => {
    const { guard } = guardFor(apiKey(), null);
    const { context } = ctx({ 'x-api-key': SECRET.plaintext });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('says the same thing for every authentication failure', async () => {
    const cases = [
      guardFor(null),
      guardFor(apiKey({ status: 'revoked' })),
      guardFor(apiKey({ expiresAt: new Date(Date.now() - 1) })),
      guardFor(apiKey(), application({ status: 'suspended' })),
    ];
    for (const { guard } of cases) {
      const { context } = ctx({ 'x-api-key': SECRET.plaintext });
      await expect(guard.canActivate(context)).rejects.toThrow('Invalid API key');
    }
  });

  it('enforces the scopes a route declares', async () => {
    const { guard } = guardFor(apiKey(), application(), [
      ApiKeyScope.STOCK_WRITE,
    ]);
    const { context } = ctx({ 'x-api-key': SECRET.plaintext });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows a route whose scopes the key carries', async () => {
    const { guard } = guardFor(apiKey(), application(), [
      ApiKeyScope.SALES_WRITE,
    ]);
    const { context } = ctx({ 'x-api-key': SECRET.plaintext });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('records when a key was last used', async () => {
    const { guard, keys } = guardFor(apiKey());
    const { context } = ctx({ 'x-api-key': SECRET.plaintext });

    await guard.canActivate(context);
    expect(keys.touchLastUsedAt).toHaveBeenCalledWith('key-1', expect.any(Date));
  });

  // The touch is bookkeeping; failing it would deny a caller who was entitled
  // to the request.
  it('still authenticates when recording last-used fails', async () => {
    const { guard, keys } = guardFor(apiKey());
    (keys.touchLastUsedAt as jest.Mock).mockRejectedValueOnce(
      new Error('db down'),
    );
    const { context } = ctx({ 'x-api-key': SECRET.plaintext });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('looks the key up by its hash, never by the secret', async () => {
    const { guard, keys } = guardFor(apiKey());
    const { context } = ctx({ 'x-api-key': SECRET.plaintext });

    await guard.canActivate(context);
    expect(keys.findByHash).toHaveBeenCalledWith(hashApiKey(SECRET.plaintext));
    expect(keys.findByHash).not.toHaveBeenCalledWith(SECRET.plaintext);
  });
});
