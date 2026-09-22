import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SaleOwnershipGuard } from './sale-ownership.guard';

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

type Tenant = {
  id: string;
  sync2booksCompanyId?: string | null;
  organizationId: string | null;
};

describe('SaleOwnershipGuard', () => {
  const ownTenant: Tenant = {
    id: 'tenant-1',
    sync2booksCompanyId: 'company-1',
    organizationId: 'org-1',
  };
  const foreignTenant: Tenant = {
    id: 'tenant-2',
    sync2booksCompanyId: 'company-2',
    organizationId: 'org-2',
  };
  const orphanTenant: Tenant = {
    id: 'tenant-3',
    sync2booksCompanyId: 'company-3',
    organizationId: null,
  };
  const complianceOnly: Tenant = {
    id: 'tenant-4',
    sync2booksCompanyId: null,
    organizationId: 'org-1',
  };

  const documents: Record<string, { id: string; merchantId: string }> = {
    'doc-own': { id: 'doc-own', merchantId: 'company-1' },
    'doc-foreign': { id: 'doc-foreign', merchantId: 'company-2' },
    'doc-orphan': { id: 'doc-orphan', merchantId: 'company-3' },
    'doc-compliance-only': { id: 'doc-compliance-only', merchantId: 'tenant-4' },
    'doc-no-business': { id: 'doc-no-business', merchantId: 'company-gone' },
  };

  function guard() {
    const tenants = [ownTenant, foreignTenant, orphanTenant, complianceOnly];
    const repo = {
      findById: jest.fn(async (id: string) => documents[id] ?? null),
    };
    const orgs = {
      getTenantBySync2booksCompanyId: jest.fn(
        async (c: string) =>
          tenants.find((t) => t.sync2booksCompanyId === c) ?? null,
      ),
      getTenantById: jest.fn(
        async (id: string) => tenants.find((t) => t.id === id) ?? null,
      ),
    };
    return new SaleOwnershipGuard(repo as never, orgs as never);
  }

  const asOrg1 = (id: unknown) => ({
    user: { organizationId: 'org-1' },
    params: { id },
    query: {},
    body: {},
  });

  it("allows a document owned by the caller's organization", async () => {
    await expect(guard().canActivate(ctx(asOrg1('doc-own')))).resolves.toBe(true);
  });

  it('resolves a compliance-only business by its own tenant id', async () => {
    await expect(
      guard().canActivate(ctx(asOrg1('doc-compliance-only'))),
    ).resolves.toBe(true);
  });

  // A 403 would confirm the id exists under someone else's account, so a
  // foreign document, a nonexistent one, one whose business has no owner and one
  // whose business no longer exists must be indistinguishable.
  it.each([
    ["another organization's document", 'doc-foreign'],
    ['a document that does not exist', 'doc-missing'],
    ['a document of a business nobody owns', 'doc-orphan'],
    ['a document whose business no longer exists', 'doc-no-business'],
    ['a blank id', ''],
    ['a non-string id', ['doc-own']],
  ])('answers 404 for %s', async (_name, id) => {
    const err = await guard()
      .canActivate(ctx(asOrg1(id)))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toEqual({
      message: 'Sale not found',
      error: 'Not Found',
      statusCode: 404,
    });
  });

  it('never looks a document up for a blank or non-string id', async () => {
    const repo = { findById: jest.fn() };
    const orgs = { getTenantBySync2booksCompanyId: jest.fn(), getTenantById: jest.fn() };
    const g = new SaleOwnershipGuard(repo as never, orgs as never);
    await g.canActivate(ctx(asOrg1(['a', 'b']))).catch(() => undefined);
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('refuses a request with no organization context', async () => {
    const req = { user: {}, params: { id: 'doc-own' }, query: {}, body: {} };
    await expect(guard().canActivate(ctx(req))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
