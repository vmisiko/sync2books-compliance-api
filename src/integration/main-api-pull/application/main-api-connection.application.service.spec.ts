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
>;
type FakeOrg = Pick<ComplianceOrganizationApplicationService, 'getTenantById'>;

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
): FakeMainApiPull {
  return {
    async createCompany(_apiKey: string, name: string) {
      await new Promise((r) => setTimeout(r, 20)); // simulate the main API round trip
      const id = `company-${createCompanyCalls.length + 1}`;
      createCompanyCalls.push(id);
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
  };
}

function fakeOrg(): FakeOrg {
  return {
    getTenantById: (id: string) =>
      Promise.resolve({ id, displayName: 'Dev merchant' } as Awaited<
        ReturnType<FakeOrg['getTenantById']>
      >),
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
});
