import { NotFoundException } from '@nestjs/common';
import { V1ScopeService } from './v1-scope.service';

const MERCHANT = 'merchant-A';

function build(overrides: {
  items?: Record<string, { id: string; merchantId: string; deletedAt?: Date | null }>;
  documents?: Record<string, { id: string; merchantId: string }>;
  branches?: Array<{ id: string; sync2booksBranchId: string | null; kraBhfId: string | null }>;
  tenant?: { id: string; sync2booksCompanyId: string | null } | null;
} = {}) {
  const items = overrides.items ?? {};
  const documents = overrides.documents ?? {};
  const organizations = {
    getTenantById: jest.fn(async () =>
      overrides.tenant === undefined
        ? { id: 'tenant-A', sync2booksCompanyId: null }
        : overrides.tenant,
    ),
    listBranches: jest.fn(async () => overrides.branches ?? []),
  };
  const catalog = {
    getItemById: jest.fn(async (id: string) => items[id] ?? null),
  };
  const sales = {
    getDocument: jest.fn(async (id: string) => {
      const document = documents[id];
      if (!document) throw new Error(`Document ${id} not found`);
      return { document };
    }),
  };
  const service = new V1ScopeService(
    organizations as never,
    catalog as never,
    sales as never,
  );
  return { service, organizations, catalog, sales };
}

describe('V1ScopeService', () => {
  describe('merchantIdFor', () => {
    it('uses the Sync2Books company id when the business has one', async () => {
      const { service } = build({ tenant: { id: 'tenant-A', sync2booksCompanyId: 'company-9' } });
      await expect(service.merchantIdFor('tenant-A')).resolves.toBe('company-9');
    });
    it('falls back to the business id for a compliance-only business', async () => {
      const { service } = build({ tenant: { id: 'tenant-A', sync2booksCompanyId: null } });
      await expect(service.merchantIdFor('tenant-A')).resolves.toBe('tenant-A');
    });
    it('404s a business that does not exist', async () => {
      const { service } = build({ tenant: null });
      await expect(service.merchantIdFor('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('items', () => {
    const items = {
      own: { id: 'own', merchantId: MERCHANT },
      theirs: { id: 'theirs', merchantId: 'merchant-B' },
      gone: { id: 'gone', merchantId: MERCHANT, deletedAt: new Date() },
    };

    it('returns an item the business owns', async () => {
      const { service } = build({ items });
      await expect(service.requireItem(MERCHANT, 'own')).resolves.toMatchObject({ id: 'own' });
    });

    // createDocument would happily snapshot another business's item onto this
    // business's sale; this is the check that stops it reaching there.
    it("answers another business's item exactly as it answers a missing one", async () => {
      const { service } = build({ items });
      const foreign = await service.requireItem(MERCHANT, 'theirs').catch((e) => e);
      const missing = await service.requireItem(MERCHANT, 'nope').catch((e) => e);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(missing).toBeInstanceOf(NotFoundException);
      // Same shape, so existence in another account is not observable.
      expect(foreign.getStatus()).toBe(missing.getStatus());
    });

    it('treats a deleted item as gone', async () => {
      const { service } = build({ items });
      await expect(service.requireItem(MERCHANT, 'gone')).rejects.toThrow(NotFoundException);
    });

    it('refuses a whole line set if any one item is foreign', async () => {
      const { service } = build({ items });
      await expect(service.requireItems(MERCHANT, ['own', 'theirs'])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('resolves a line set of owned items, deduplicated', async () => {
      const { service } = build({ items });
      const found = await service.requireItems(MERCHANT, ['own', 'own']);
      expect([...found.keys()]).toEqual(['own']);
    });
  });

  describe('sales', () => {
    const documents = {
      mine: { id: 'mine', merchantId: MERCHANT },
      theirs: { id: 'theirs', merchantId: 'merchant-B' },
    };

    it('returns a sale the business owns', async () => {
      const { service } = build({ documents });
      await expect(service.requireSale(MERCHANT, 'mine')).resolves.toMatchObject({ id: 'mine' });
    });

    it("404s another business's sale, indistinguishably from an unknown one", async () => {
      const { service } = build({ documents });
      const foreign = await service.requireSale(MERCHANT, 'theirs').catch((e) => e);
      const unknown = await service.requireSale(MERCHANT, 'nope').catch((e) => e);
      expect(foreign).toBeInstanceOf(NotFoundException);
      expect(unknown).toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveBranch', () => {
    const branches = [
      { id: 'branch-uuid-1', sync2booksBranchId: 'sb-1', kraBhfId: '00' },
      { id: 'branch-uuid-2', sync2booksBranchId: null, kraBhfId: '01' },
    ];

    it('defaults to the first branch when none is named', async () => {
      const { service } = build({ branches });
      await expect(service.resolveBranch('tenant-A')).resolves.toMatchObject({ id: 'branch-uuid-1' });
    });
    it.each([['branch-uuid-2'], ['sb-1'], ['01']])('resolves %s within the business', async (ref) => {
      const { service } = build({ branches });
      await expect(service.resolveBranch('tenant-A', ref)).resolves.toBeDefined();
    });
    it("404s a branch that is not this business's", async () => {
      const { service, organizations } = build({ branches });
      await expect(service.resolveBranch('tenant-A', 'other-tenants-branch')).rejects.toThrow(
        NotFoundException,
      );
      // Scoped to the tenant, never a global lookup.
      expect(organizations.listBranches).toHaveBeenCalledWith('tenant-A');
    });
    it('404s a business with no branches instead of inventing one', async () => {
      const { service } = build({ branches: [] });
      await expect(service.resolveBranch('tenant-A')).rejects.toThrow(NotFoundException);
    });
  });
});
