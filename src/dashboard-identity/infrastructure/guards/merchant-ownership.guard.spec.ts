import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MerchantIdOptional } from './merchant-id-optional.decorator';
import { MerchantOwnershipGuard } from './merchant-ownership.guard';

// Real decorators on real handlers, so the guard's Reflector lookup is exercised
// for what it reads in production (handler metadata, then class metadata).
class Routes {
  scoped() {}

  @MerchantIdOptional()
  optional() {}
}

@MerchantIdOptional()
class OptionalRoutes {
  scoped() {}
}

function ctx(
  req: Record<string, unknown>,
  handler: () => void = Routes.prototype.scoped,
  cls: new () => unknown = Routes,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

function organizations(
  tenants: Array<{
    id: string;
    sync2booksCompanyId?: string | null;
    organizationId: string | null;
  }>,
) {
  return {
    getTenantBySync2booksCompanyId: jest.fn(async (companyId: string) =>
      tenants.find((t) => t.sync2booksCompanyId === companyId) ?? null,
    ),
    getTenantById: jest.fn(
      async (id: string) => tenants.find((t) => t.id === id) ?? null,
    ),
  };
}

describe('MerchantOwnershipGuard', () => {
  const ownTenant = {
    id: 'tenant-1',
    sync2booksCompanyId: 'company-1',
    organizationId: 'org-1',
  };
  const foreignTenant = {
    id: 'tenant-2',
    sync2booksCompanyId: 'company-2',
    organizationId: 'org-2',
  };

  function guardFor(
    tenants: Parameters<typeof organizations>[0],
  ): [MerchantOwnershipGuard, ReturnType<typeof organizations>] {
    const orgs = organizations(tenants);
    return [new MerchantOwnershipGuard(orgs as never, new Reflector()), orgs];
  }

  it("allows a merchantId owned by the caller's organization", async () => {
    const [guard] = guardFor([ownTenant, foreignTenant]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query: { merchantId: 'company-1' },
      body: {},
    };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  // The JWT proves which organization the caller belongs to, never which
  // business -- this is the check dashboard-api/sales and friends were missing.
  it("rejects another organization's merchantId", async () => {
    const [guard] = guardFor([ownTenant, foreignTenant]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query: { merchantId: 'company-2' },
      body: {},
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('resolves a compliance-only business by its own tenant id', async () => {
    const complianceOnly = {
      id: 'tenant-3',
      sync2booksCompanyId: null,
      organizationId: 'org-1',
    };
    const [guard] = guardFor([complianceOnly]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query: {},
      body: { merchantId: 'tenant-3' },
    };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it('refuses an unowned tenant rather than leaking it to whoever asks', async () => {
    const orphan = {
      id: 'tenant-4',
      sync2booksCompanyId: 'company-4',
      organizationId: null,
    };
    const [guard] = guardFor([orphan]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query: { merchantId: 'company-4' },
      body: {},
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('404s an unknown merchantId', async () => {
    const [guard] = guardFor([ownTenant]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query: { merchantId: 'nope' },
      body: {},
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      NotFoundException,
    );
  });

  // TypeORM skips an `undefined` where-key, so PATCH customers/:id without a
  // merchantId used to find the row by bare id, whichever organization owned it.
  it('refuses a request that names no merchantId', async () => {
    const [guard, orgs] = guardFor([ownTenant]);
    const req = {
      user: { organizationId: 'org-1' },
      params: { id: 'customer-of-org-2' },
      query: {},
      body: {},
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      BadRequestException,
    );
    expect(orgs.getTenantBySync2booksCompanyId).not.toHaveBeenCalled();
  });

  it('treats a blank merchantId as absent', async () => {
    const [guard] = guardFor([ownTenant]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query: { merchantId: '   ' },
      body: {},
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('leaves a @MerchantIdOptional route to whatever else scopes it', async () => {
    const [guard, orgs] = guardFor([ownTenant]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query: {},
      body: {},
    };
    await expect(
      guard.canActivate(ctx(req, Routes.prototype.optional)),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(ctx(req, OptionalRoutes.prototype.scoped, OptionalRoutes)),
    ).resolves.toBe(true);
    expect(orgs.getTenantBySync2booksCompanyId).not.toHaveBeenCalled();
  });

  it('still verifies a merchantId on a @MerchantIdOptional route', async () => {
    const [guard] = guardFor([ownTenant, foreignTenant]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query: { merchantId: 'company-2' },
      body: {},
    };
    await expect(
      guard.canActivate(ctx(req, Routes.prototype.optional)),
    ).rejects.toThrow(ForbiddenException);
  });

  // The handler reads @Body() on POST routes and @Query() on others. Checking
  // only the first source found let a caller pair an owned id in the query with
  // a foreign one in the body: POST sales/sync?merchantId=<own> with
  // {merchantId:<foreign>} retried -- i.e. re-submitted to KRA -- the foreign
  // business's documents.
  it.each([
    ['owned query, foreign body', { merchantId: 'company-1' }, { merchantId: 'company-2' }],
    ['foreign query, owned body', { merchantId: 'company-2' }, { merchantId: 'company-1' }],
  ])('checks every source, not the first: %s', async (_name, query, body) => {
    const [guard] = guardFor([ownTenant, foreignTenant]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query,
      body,
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows the same owned merchantId repeated across sources', async () => {
    const [guard] = guardFor([ownTenant, foreignTenant]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query: { merchantId: 'company-1' },
      body: { merchantId: 'company-1' },
    };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  // `?merchantId=a&merchantId=b` parses to an array. A typeof-string check
  // reads that as "no merchantId" and lets it through to the handler.
  it.each([
    ['repeated query key', { merchantId: ['company-1', 'company-2'] }, {}],
    ['bracketed query key', { merchantId: { x: 'company-2' } }, {}],
    ['object in the body', {}, { merchantId: { $ne: null } }],
    ['number in the body', {}, { merchantId: 7 }],
  ])('refuses a merchantId that is not a plain string: %s', async (_n, query, body) => {
    const [guard] = guardFor([ownTenant, foreignTenant]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query,
      body,
    };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('tolerates a missing or array body', async () => {
    const [guard] = guardFor([ownTenant]);
    for (const body of [undefined, null, [{ merchantId: 'company-2' }]]) {
      const req = {
        user: { organizationId: 'org-1' },
        params: {},
        query: { merchantId: 'company-1' },
        body,
      };
      await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    }
  });
});
