import { ExecutionContext, HttpException } from '@nestjs/common';
import type { IRateLimitStore } from '../../application/ports/rate-limit-store.port';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import { MemoryRateLimitStore } from '../rate-limit/memory-rate-limit.store';
import { ApiRateLimitGuard } from './api-rate-limit.guard';
import type { ApiCaller, ApiKeyRequest } from './api-caller';

function caller(overrides: Partial<ApiCaller> = {}): ApiCaller {
  return {
    apiKeyId: 'key-1',
    applicationId: 'app-1',
    organizationId: 'org-1',
    environment: ConnectionEnvironment.SANDBOX,
    scopes: [ApiKeyScope.SALES_WRITE],
    rateLimitPerMin: 3,
    ...overrides,
  };
}

function ctx(apiCaller?: ApiCaller): {
  context: ExecutionContext;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const req = { apiCaller } as ApiKeyRequest;
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };
  return {
    context: {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext,
    headers,
  };
}

describe('ApiRateLimitGuard', () => {
  it('publishes the limit, what is left, and when it resets', async () => {
    const guard = new ApiRateLimitGuard(new MemoryRateLimitStore());
    const { context, headers } = ctx(caller());

    await guard.canActivate(context);

    expect(headers['X-RateLimit-Limit']).toBe('3');
    expect(headers['X-RateLimit-Remaining']).toBe('2');
    expect(Number(headers['X-RateLimit-Reset'])).toBeGreaterThan(0);
  });

  it('counts down and then refuses with Retry-After', async () => {
    const store = new MemoryRateLimitStore();
    const guard = new ApiRateLimitGuard(store);

    for (const expected of ['2', '1', '0']) {
      const { context, headers } = ctx(caller());
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(headers['X-RateLimit-Remaining']).toBe(expected);
    }

    const { context, headers } = ctx(caller());
    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    expect(headers['Retry-After']).toBeDefined();
    expect(headers['X-RateLimit-Remaining']).toBe('0');
  });

  it('refuses with 429', async () => {
    const store = new MemoryRateLimitStore();
    const guard = new ApiRateLimitGuard(store);
    for (let i = 0; i < 3; i++) await guard.canActivate(ctx(caller()).context);

    await expect(
      guard.canActivate(ctx(caller()).context),
    ).rejects.toMatchObject({ status: 429 });
  });

  // Two applications are two integrations; one must not exhaust the other.
  it('budgets each application separately', async () => {
    const store = new MemoryRateLimitStore();
    const guard = new ApiRateLimitGuard(store);
    for (let i = 0; i < 3; i++) await guard.canActivate(ctx(caller()).context);

    const other = ctx(caller({ applicationId: 'app-2' }));
    await expect(guard.canActivate(other.context)).resolves.toBe(true);
    expect(other.headers['X-RateLimit-Remaining']).toBe('2');
  });

  // Rotating a key must not hand the caller a second allowance.
  it('shares one budget across an application’s keys', async () => {
    const store = new MemoryRateLimitStore();
    const guard = new ApiRateLimitGuard(store);
    await guard.canActivate(ctx(caller({ apiKeyId: 'key-1' })).context);

    const rotated = ctx(caller({ apiKeyId: 'key-2' }));
    await guard.canActivate(rotated.context);
    expect(rotated.headers['X-RateLimit-Remaining']).toBe('1');
  });

  // Counting a request nobody authenticated would let a stranger burn a real
  // application's budget.
  it('does not count an unauthenticated request', async () => {
    const store = {
      kind: 'memory' as const,
      hit: jest.fn(),
    } satisfies IRateLimitStore;
    const guard = new ApiRateLimitGuard(store);

    await expect(guard.canActivate(ctx(undefined).context)).resolves.toBe(true);
    expect(store.hit).not.toHaveBeenCalled();
  });
});
