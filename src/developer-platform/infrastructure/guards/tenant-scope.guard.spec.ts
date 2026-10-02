import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import type { ApiCaller, ApiKeyRequest } from './api-caller';
import { TenantScopeGuard } from './tenant-scope.guard';

type FakeTenant = {
  id: string;
  displayName: string | null;
  organizationId: string | null;
  environment: ConnectionEnvironment | null;
};

const ownSandbox: FakeTenant = {
  id: 'tenant-1',
  displayName: 'Gear Train Engineering',
  organizationId: 'org-1',
  environment: ConnectionEnvironment.SANDBOX,
};
const ownProduction: FakeTenant = {
  id: 'tenant-2',
  displayName: 'Gear Train Live',
  organizationId: 'org-1',
  environment: ConnectionEnvironment.PRODUCTION,
};
const foreign: FakeTenant = {
  id: 'tenant-3',
  displayName: 'Someone Else Ltd',
  organizationId: 'org-2',
  environment: ConnectionEnvironment.SANDBOX,
};

function organizations(tenants: FakeTenant[]) {
  return {
    getTenantByMerchantId: jest.fn(
      async (id: string) => tenants.find((t) => t.id === id) ?? null,
    ),
    getTenantById: jest.fn(
      async (id: string) => tenants.find((t) => t.id === id) ?? null,
    ),
    getTenantEnvironment: jest.fn(
      async (id: string) => tenants.find((t) => t.id === id)?.environment ?? null,
    ),
  } as unknown as ComplianceOrganizationApplicationService;
}

function caller(overrides: Partial<ApiCaller> = {}): ApiCaller {
  return {
    apiKeyId: 'key-1',
    applicationId: 'app-1',
    organizationId: 'org-1',
    environment: ConnectionEnvironment.SANDBOX,
    businessId: null,
    scopes: [ApiKeyScope.SALES_WRITE],
    rateLimitPerMin: 120,
    ...overrides,
  };
}

function ctx(req: Partial<ApiKeyRequest>): {
  context: ExecutionContext;
  req: ApiKeyRequest;
} {
  const full = { params: {}, query: {}, body: {}, ...req } as ApiKeyRequest;
  return {
    context: {
      switchToHttp: () => ({ getRequest: () => full }),
    } as unknown as ExecutionContext,
    req: full,
  };
}

describe('TenantScopeGuard', () => {
  it('allows a business the key’s organization owns, and records it', async () => {
    const guard = new TenantScopeGuard(organizations([ownSandbox, foreign]));
    const { context, req } = ctx({
      apiCaller: caller(),
      body: { businessId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.apiTenantId).toBe('tenant-1');
  });

  it.each([
    ['path param', { params: { businessId: 'tenant-3' } }],
    ['query string', { query: { businessId: 'tenant-3' } }],
    ['body', { body: { businessId: 'tenant-3' } }],
    ['merchantId alias', { body: { merchantId: 'tenant-3' } }],
  ])(
    'refuses another organization’s business named in the %s',
    async (_where, parts) => {
      const guard = new TenantScopeGuard(organizations([ownSandbox, foreign]));
      const { context } = ctx({ apiCaller: caller(), ...parts });

      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    },
  );

  // Filing real tax data from a test integration is not an error anyone can
  // take back, so the environments are held apart in both directions.
  it('refuses a sandbox key pointed at a production business', async () => {
    const guard = new TenantScopeGuard(organizations([ownProduction]));
    const { context } = ctx({
      apiCaller: caller({ environment: ConnectionEnvironment.SANDBOX }),
      body: { businessId: 'tenant-2' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a production key pointed at a sandbox business', async () => {
    const guard = new TenantScopeGuard(organizations([ownSandbox]));
    const { context } = ctx({
      apiCaller: caller({ environment: ConnectionEnvironment.PRODUCTION }),
      body: { businessId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows a production key against a production business', async () => {
    const guard = new TenantScopeGuard(organizations([ownProduction]));
    const { context } = ctx({
      apiCaller: caller({ environment: ConnectionEnvironment.PRODUCTION }),
      body: { businessId: 'tenant-2' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  // "No connection yet" must not be read as "probably sandbox" -- guessing here
  // is how a half-provisioned business would become addressable.
  it('refuses a business with no eTIMS connection rather than assuming one', async () => {
    const guard = new TenantScopeGuard(
      organizations([{ ...ownSandbox, environment: null }]),
    );
    const { context } = ctx({
      apiCaller: caller(),
      body: { businessId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a business owned by no organization at all', async () => {
    const guard = new TenantScopeGuard(
      organizations([{ ...ownSandbox, organizationId: null }]),
    );
    const { context } = ctx({
      apiCaller: caller(),
      body: { businessId: 'tenant-1' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('404s an unknown business', async () => {
    const guard = new TenantScopeGuard(organizations([ownSandbox]));
    const { context } = ctx({
      apiCaller: caller(),
      body: { businessId: 'nope' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
  });

  it('leaves a route that names no business alone', async () => {
    const orgs = organizations([ownSandbox]);
    const guard = new TenantScopeGuard(orgs);
    const { context, req } = ctx({ apiCaller: caller() });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.apiTenantId).toBeUndefined();
    expect(orgs.getTenantByMerchantId).not.toHaveBeenCalled();
  });

  // Mounting this guard without ComplianceApiKeyGuard in front is a wiring
  // mistake; failing open would make it an invisible one.
  it('refuses when nothing authenticated the caller', async () => {
    const guard = new TenantScopeGuard(organizations([ownSandbox]));
    const { context } = ctx({ body: { businessId: 'tenant-1' } });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('TenantScopeGuard with a key bound to one business', () => {
  const bound = (overrides: Partial<ApiCaller> = {}) =>
    caller({ businessId: 'tenant-1', ...overrides });
  const guardFor = (tenants: FakeTenant[]) =>
    new TenantScopeGuard(organizations(tenants));

  it('needs no businessId: the key is the business', async () => {
    const { context, req } = ctx({ apiCaller: bound() });
    await expect(
      guardFor([ownSandbox, ownProduction]).canActivate(context),
    ).resolves.toBe(true);
    expect(req.apiTenantId).toBe('tenant-1');
  });

  it('accepts a request that names the same business', async () => {
    const { context, req } = ctx({
      apiCaller: bound(),
      body: { businessId: 'tenant-1' },
    });
    await expect(guardFor([ownSandbox]).canActivate(context)).resolves.toBe(
      true,
    );
    expect(req.apiTenantId).toBe('tenant-1');
  });

  it("refuses another of the organization's own businesses", async () => {
    const { context, req } = ctx({
      apiCaller: bound({ environment: ConnectionEnvironment.PRODUCTION }),
      body: { businessId: 'tenant-2' },
    });
    await expect(
      guardFor([ownSandbox, ownProduction]).canActivate(context),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(req.apiTenantId).toBeUndefined();
  });

  it('refuses a foreign business and an unknown id with the same 403, so ids cannot be probed', async () => {
    const guard = guardFor([ownSandbox, foreign]);
    const messages: string[] = [];
    for (const id of ['tenant-3', 'does-not-exist']) {
      const { context } = ctx({
        apiCaller: bound(),
        query: { businessId: id },
      });
      await guard.canActivate(context).catch((e: ForbiddenException) => {
        expect(e).toBeInstanceOf(ForbiddenException);
        messages.push(e.message);
      });
    }
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(messages[1]);
  });

  it('still enforces the environment rail', async () => {
    const { context } = ctx({
      apiCaller: bound({ environment: ConnectionEnvironment.PRODUCTION }),
    });
    await expect(
      guardFor([ownSandbox]).canActivate(context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the bound business has since moved to another organization', async () => {
    const { context } = ctx({ apiCaller: bound() });
    await expect(
      guardFor([{ ...ownSandbox, organizationId: 'org-2' }]).canActivate(
        context,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the bound business no longer exists', async () => {
    const { context } = ctx({ apiCaller: bound() });
    await expect(guardFor([]).canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
