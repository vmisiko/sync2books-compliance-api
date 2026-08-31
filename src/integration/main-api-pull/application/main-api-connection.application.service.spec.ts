import { MainApiConnectionApplicationService } from './main-api-connection.application.service';
import type { IMainApiConnectionRepository } from './ports/main-api-connection.repository.port';
import type { MainApiConnection } from '../domain/entities/main-api-connection.entity';
import type { MainApiPullClient } from '../infrastructure/http/main-api-pull.client';
import type { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';

type FakeMainApiPull = Pick<
  MainApiPullClient,
  | 'createCompany'
  | 'createWebhookEndpoint'
  | 'setWebhookEndpointEnvironmentToAny'
  | 'companyExists'
  | 'getEnabledIntegrationKeys'
>;
type FakeOrg = Pick<
  ComplianceOrganizationApplicationService,
  'getTenantById' | 'upsertTenant'
>;

/**
 * In-memory fake standing in for the real TypeORM repo — includes an
 * artificial delay so findByTenantId/save behave like real async DB calls
 * with a race window, the same shape as the bug reproduced against the real
 * mysql-backed repository.
 */
class FakeRepo implements IMainApiConnectionRepository {
  private rows = new Map<string, MainApiConnection>();
  async findByTenantId(tenantId: string): Promise<MainApiConnection | null> {
    await new Promise((r) => setTimeout(r, 5));
    const found = [...this.rows.values()].find(
      (c) => c.complianceTenantId === tenantId,
    );
    return found ? { ...found } : null;
  }
  async save(connection: MainApiConnection): Promise<MainApiConnection> {
    await new Promise((r) => setTimeout(r, 5));
    this.rows.set(connection.id, { ...connection });
    return { ...connection };
  }
}

function fakeMainApiPull(
  createCompanyCalls: string[],
  createWebhookCalls: string[],
  /** company ids the fake main API currently considers live — defaults to
   * none, matching the pre-existing tests below (they all start from a
   * fresh tenant with no mainApiCompanyId, so companyExists is never even
   * reached — see the `!!connection.mainApiCompanyId &&` short-circuit). */
  existingCompanyIds: Set<string> = new Set(),
): FakeMainApiPull {
  return {
    async createCompany(_apiKey: string, name: string) {
      await new Promise((r) => setTimeout(r, 20)); // simulate the main API round trip
      const id = `company-${createCompanyCalls.length + 1}`;
      createCompanyCalls.push(id);
      existingCompanyIds.add(id);
      return { company: { id, name } };
    },
    async createWebhookEndpoint(
      _apiKey: string,
      input: { name: string; url: string; eventTypes: string[] },
    ) {
      await new Promise((r) => setTimeout(r, 20));
      const id = `webhook-${createWebhookCalls.length + 1}`;
      createWebhookCalls.push(id);
      return {
        id,
        secret: 'secret',
        url: input.url,
        eventTypes: input.eventTypes,
      };
    },
    setWebhookEndpointEnvironmentToAny: () => Promise.resolve(undefined),
    async companyExists(_apiKey: string, companyId: string) {
      await new Promise((r) => setTimeout(r, 5));
      return existingCompanyIds.has(companyId);
    },
    getEnabledIntegrationKeys: () =>
      Promise.resolve([
        'quickbooks',
        'odoo',
        'microsoft-dynamics-365-business-central',
      ]),
  };
}

function fakeOrg(): FakeOrg {
  return {
    getTenantById: (id: string) =>
      Promise.resolve({ id, displayName: 'Dev merchant' } as Awaited<
        ReturnType<FakeOrg['getTenantById']>
      >),
    // Not under test in this describe block — see the dedicated
    // ensureCompany/resolveMerchantId stamping tests below.
    upsertTenant: (input) =>
      Promise.resolve({
        tenant: {
          id: input.id,
          sync2booksCompanyId: input.sync2booksCompanyId,
        },
        defaultBranchId: 'branch-1',
        etimsConnection: null,
      } as Awaited<ReturnType<FakeOrg['upsertTenant']>>),
  };
}

describe('MainApiConnectionApplicationService.ensureCompany', () => {
  it('reuses the existing company/webhook across sequential calls', async () => {
    const createCompanyCalls: string[] = [];
    const createWebhookCalls: string[] = [];
    const repo = new FakeRepo();
    const svc = new MainApiConnectionApplicationService(
      repo,
      fakeMainApiPull(
        createCompanyCalls,
        createWebhookCalls,
      ) as MainApiPullClient,
      fakeOrg() as ComplianceOrganizationApplicationService,
    );

    await svc.upsert('tenant-1', {
      mainApiApplicationId: 'app-1',
      mainApiApiKey: 'key-1',
    });
    await svc.ensureCompany('tenant-1');
    await svc.ensureCompany('tenant-1');

    expect(createCompanyCalls.length).toBe(1);
    expect(createWebhookCalls.length).toBe(1);
  });

  it('does not create duplicate companies/webhooks when called concurrently for the same tenant', async () => {
    // Regression test for the bug where the main API's companies table ended
    // up with multiple "Dev merchant" rows (and webhook_endpoints ended up
    // with multiple identical registrations): two near-simultaneous calls
    // (React StrictMode's double effect invocation, two tabs, a retry, etc.)
    // both used to read mainApiCompanyId as null before either write landed,
    // so each created its own remote Company/webhook endpoint.
    const createCompanyCalls: string[] = [];
    const createWebhookCalls: string[] = [];
    const repo = new FakeRepo();
    const svc = new MainApiConnectionApplicationService(
      repo,
      fakeMainApiPull(
        createCompanyCalls,
        createWebhookCalls,
      ) as MainApiPullClient,
      fakeOrg() as ComplianceOrganizationApplicationService,
    );

    await svc.upsert('tenant-1', {
      mainApiApplicationId: 'app-1',
      mainApiApiKey: 'key-1',
    });

    const [a, b] = await Promise.all([
      svc.ensureCompany('tenant-1'),
      svc.ensureCompany('tenant-1'),
    ]);

    expect(createCompanyCalls.length).toBe(1);
    expect(createWebhookCalls.length).toBe(1);
    expect(a.mainApiCompanyId).toBe(b.mainApiCompanyId);
    expect(a.webhookEndpointId).toBe(b.webhookEndpointId);

    const status = await svc.getStatus('tenant-1');
    expect(status.mainApiCompanyId).toBe(createCompanyCalls[0]);
  });

  it('does not race across two different tenants (each still gets its own company)', async () => {
    const createCompanyCalls: string[] = [];
    const createWebhookCalls: string[] = [];
    const repo = new FakeRepo();
    const svc = new MainApiConnectionApplicationService(
      repo,
      fakeMainApiPull(
        createCompanyCalls,
        createWebhookCalls,
      ) as MainApiPullClient,
      fakeOrg() as ComplianceOrganizationApplicationService,
    );

    await svc.upsert('tenant-1', {
      mainApiApplicationId: 'app-1',
      mainApiApiKey: 'key-1',
    });
    await svc.upsert('tenant-2', {
      mainApiApplicationId: 'app-2',
      mainApiApiKey: 'key-2',
    });

    await Promise.all([
      svc.ensureCompany('tenant-1'),
      svc.ensureCompany('tenant-2'),
    ]);

    expect(createCompanyCalls.length).toBe(2);
    expect(createWebhookCalls.length).toBe(2);
  });

  it('recreates the main-API company when the cached mainApiCompanyId no longer exists there', async () => {
    // Regression test: a company can be removed on the main API side (e.g.
    // direct DB cleanup of duplicate test companies) without compliance-api
    // ever finding out, leaving a stale mainApiCompanyId that 404s downstream
    // (auth-url, connect, etc). ensureCompany must notice and recreate.
    const createCompanyCalls: string[] = [];
    const createWebhookCalls: string[] = [];
    const existingCompanyIds = new Set<string>(); // the cached id is NOT among these
    const repo = new FakeRepo();
    const svc = new MainApiConnectionApplicationService(
      repo,
      fakeMainApiPull(
        createCompanyCalls,
        createWebhookCalls,
        existingCompanyIds,
      ) as MainApiPullClient,
      fakeOrg() as ComplianceOrganizationApplicationService,
    );

    await svc.upsert('tenant-1', {
      mainApiApplicationId: 'app-1',
      mainApiApiKey: 'key-1',
    });
    const seeded = await repo.findByTenantId('tenant-1');
    await repo.save({
      ...seeded!,
      mainApiCompanyId: 'deleted-company-id',
      webhookEndpointId: 'webhook-existing',
      webhookSecret: 'secret',
    });

    const result = await svc.ensureCompany('tenant-1');

    expect(createCompanyCalls.length).toBe(1);
    expect(result.mainApiCompanyId).toBe(createCompanyCalls[0]);
    expect(result.mainApiCompanyId).not.toBe('deleted-company-id');
  });

  it('does not recreate the company when the cached mainApiCompanyId still exists on the main API', async () => {
    const createCompanyCalls: string[] = [];
    const createWebhookCalls: string[] = [];
    const existingCompanyIds = new Set<string>(['live-company-id']);
    const repo = new FakeRepo();
    const svc = new MainApiConnectionApplicationService(
      repo,
      fakeMainApiPull(
        createCompanyCalls,
        createWebhookCalls,
        existingCompanyIds,
      ) as MainApiPullClient,
      fakeOrg() as ComplianceOrganizationApplicationService,
    );

    await svc.upsert('tenant-1', {
      mainApiApplicationId: 'app-1',
      mainApiApiKey: 'key-1',
    });
    const seeded = await repo.findByTenantId('tenant-1');
    await repo.save({
      ...seeded!,
      mainApiCompanyId: 'live-company-id',
      webhookEndpointId: 'webhook-existing',
      webhookSecret: 'secret',
    });

    const result = await svc.ensureCompany('tenant-1');

    expect(createCompanyCalls.length).toBe(0);
    expect(result.mainApiCompanyId).toBe('live-company-id');
  });

  it('stamps sync2booksCompanyId onto the tenant once mainApiCompanyId is established', async () => {
    const repo = new FakeRepo();
    const upsertTenantCalls: Array<{
      id?: string | null;
      sync2booksCompanyId?: string | null;
    }> = [];
    const org: FakeOrg = {
      ...fakeOrg(),
      upsertTenant: (input) => {
        upsertTenantCalls.push(input);
        return Promise.resolve({
          tenant: {
            id: input.id!,
            sync2booksCompanyId: input.sync2booksCompanyId ?? null,
          },
          defaultBranchId: 'branch-1',
          etimsConnection: null,
        } as Awaited<ReturnType<FakeOrg['upsertTenant']>>);
      },
    };
    const svc = new MainApiConnectionApplicationService(
      repo,
      fakeMainApiPull([], []) as MainApiPullClient,
      org as ComplianceOrganizationApplicationService,
    );
    await svc.upsert('tenant-1', {
      mainApiApplicationId: 'app-1',
      mainApiApiKey: 'key-1',
    });

    await svc.ensureCompany('tenant-1');

    expect(upsertTenantCalls).toContainEqual(
      expect.objectContaining({
        id: 'tenant-1',
        sync2booksCompanyId: 'company-1',
      }),
    );
  });
});

describe('MainApiConnectionApplicationService.resolveMerchantId', () => {
  it('returns the tenant sync2booksCompanyId directly, without touching ensureCompany, when already set', async () => {
    const repo = new FakeRepo();
    let createCompanyCalled = false;
    const fakeMainApiPullSpy: FakeMainApiPull = {
      ...fakeMainApiPull([], []),
      async createCompany(apiKey: string, name: string) {
        createCompanyCalled = true;
        return fakeMainApiPull([], []).createCompany(apiKey, name);
      },
    };
    const org: FakeOrg = {
      getTenantById: (id: string) =>
        Promise.resolve({
          id,
          displayName: 'Dev merchant',
          sync2booksCompanyId: 'company-already-linked',
        } as Awaited<ReturnType<FakeOrg['getTenantById']>>),
      upsertTenant: fakeOrg().upsertTenant,
    };
    const svc = new MainApiConnectionApplicationService(
      repo,
      fakeMainApiPullSpy as MainApiPullClient,
      org as ComplianceOrganizationApplicationService,
    );

    const merchantId = await svc.resolveMerchantId('tenant-1');

    expect(merchantId).toBe('company-already-linked');
    expect(createCompanyCalled).toBe(false);
  });

  it('self-heals: creates/links mainApiCompanyId via ensureCompany and returns it when sync2booksCompanyId was never stamped', async () => {
    const repo = new FakeRepo();
    let currentSync2booksCompanyId: string | null = null;
    const org: FakeOrg = {
      getTenantById: (id: string) =>
        Promise.resolve({
          id,
          displayName: 'Dev merchant',
          sync2booksCompanyId: currentSync2booksCompanyId,
        } as Awaited<ReturnType<FakeOrg['getTenantById']>>),
      upsertTenant: (input) => {
        currentSync2booksCompanyId =
          input.sync2booksCompanyId ?? currentSync2booksCompanyId;
        return Promise.resolve({
          tenant: {
            id: input.id!,
            sync2booksCompanyId: currentSync2booksCompanyId,
          },
          defaultBranchId: 'branch-1',
          etimsConnection: null,
        } as Awaited<ReturnType<FakeOrg['upsertTenant']>>);
      },
    };
    const svc = new MainApiConnectionApplicationService(
      repo,
      fakeMainApiPull([], []) as MainApiPullClient,
      org as ComplianceOrganizationApplicationService,
    );
    await svc.upsert('tenant-1', {
      mainApiApplicationId: 'app-1',
      mainApiApiKey: 'key-1',
    });

    const merchantId = await svc.resolveMerchantId('tenant-1');

    expect(merchantId).toBe('company-1');
    expect(currentSync2booksCompanyId).toBe('company-1');
  });
});

describe('MainApiConnectionApplicationService.getStatus', () => {
  function svcWithEnabledKeys(
    repo: FakeRepo,
    enabledKeys: string[],
  ): MainApiConnectionApplicationService {
    const fake: FakeMainApiPull = {
      ...fakeMainApiPull([], []),
      getEnabledIntegrationKeys: () => Promise.resolve(enabledKeys),
    };
    return new MainApiConnectionApplicationService(
      repo,
      fake as MainApiPullClient,
      fakeOrg() as ComplianceOrganizationApplicationService,
    );
  }

  it('only includes integrations enabled on the shared Main API Application', async () => {
    const repo = new FakeRepo();
    const svc = svcWithEnabledKeys(repo, ['quickbooks']);
    await svc.upsert('tenant-1', {
      mainApiApplicationId: 'app-1',
      mainApiApiKey: 'key-1',
    });

    const status = await svc.getStatus('tenant-1');

    expect(status.integrations.map((i) => i.integrationKey)).toEqual([
      'quickbooks',
    ]);
  });

  it('still includes an integration the tenant already has a live connection to, even if no longer enabled', async () => {
    const repo = new FakeRepo();
    const svc = svcWithEnabledKeys(repo, ['quickbooks']);
    await svc.upsert('tenant-1', {
      mainApiApplicationId: 'app-1',
      mainApiApiKey: 'key-1',
    });
    await svc.recordConnection('tenant-1', 'odoo', 'odoo-connection-1');

    const status = await svc.getStatus('tenant-1');

    expect(status.integrations.map((i) => i.integrationKey).sort()).toEqual([
      'odoo',
      'quickbooks',
    ]);
    const odoo = status.integrations.find((i) => i.integrationKey === 'odoo');
    expect(odoo?.connectionState).toBe('connected');
  });

  it('falls back to every supported integration if the main API call fails', async () => {
    const repo = new FakeRepo();
    const fake: FakeMainApiPull = {
      ...fakeMainApiPull([], []),
      getEnabledIntegrationKeys: () =>
        Promise.reject(new Error('main API unreachable')),
    };
    const svc = new MainApiConnectionApplicationService(
      repo,
      fake as MainApiPullClient,
      fakeOrg() as ComplianceOrganizationApplicationService,
    );
    await svc.upsert('tenant-1', {
      mainApiApplicationId: 'app-1',
      mainApiApiKey: 'key-1',
    });

    const status = await svc.getStatus('tenant-1');

    expect(status.integrations.map((i) => i.integrationKey).sort()).toEqual([
      'microsoft-dynamics-365-business-central',
      'odoo',
      'quickbooks',
    ]);
  });

  describe('self-healing a missing connection row', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    afterEach(() => {
      process.env = ORIGINAL_ENV;
    });

    it('seeds a connection from the global credentials for a tenant with no row yet, instead of 404ing', async () => {
      process.env.MAIN_API_APPLICATION_ID = 'shared-app';
      process.env.MAIN_API_API_KEY = 'shared-key';
      const repo = new FakeRepo();
      const svc = svcWithEnabledKeys(repo, ['quickbooks']);

      // No svc.upsert() call first — this tenant has never been seen before,
      // matching a pre-existing tenant that predates MAIN_API_APPLICATION_ID
      // being configured, or one whose business-creation seed failed.
      const status = await svc.getStatus('never-seen-tenant');

      expect(status.configured).toBe(true);
      expect(status.mainApiApplicationId).toBe('shared-app');
      expect(status.integrations.map((i) => i.integrationKey)).toEqual([
        'quickbooks',
      ]);
    });

    it('degrades gracefully instead of throwing when the global credentials themselves are unset', async () => {
      delete process.env.MAIN_API_APPLICATION_ID;
      delete process.env.MAIN_API_API_KEY;
      const repo = new FakeRepo();
      const svc = svcWithEnabledKeys(repo, ['quickbooks']);

      const status = await svc.getStatus('never-seen-tenant');

      expect(status.configured).toBe(false);
      expect(status.mainApiApplicationId).toBeNull();
    });
  });
});
