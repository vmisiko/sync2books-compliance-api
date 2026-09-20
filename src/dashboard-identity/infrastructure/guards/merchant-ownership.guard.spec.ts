import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MerchantOwnershipGuard } from './merchant-ownership.guard';

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
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
    return [new MerchantOwnershipGuard(orgs as never), orgs];
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

  it('leaves routes without a merchantId to ActiveTenantGuard', async () => {
    const [guard, orgs] = guardFor([ownTenant]);
    const req = {
      user: { organizationId: 'org-1' },
      params: {},
      query: {},
      body: {},
    };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(orgs.getTenantBySync2booksCompanyId).not.toHaveBeenCalled();
  });
});
