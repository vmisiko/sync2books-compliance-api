import type { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import type { ApiCaller } from '../../infrastructure/guards/api-caller';
import { V1BusinessesController } from './v1-businesses.controller';
import { V1MeController } from './v1-me.controller';

const tenants = [
  { id: 't-1', displayName: 'Gear Train Engineering' },
  { id: 't-2', displayName: 'Gear Train Foods' },
];

const controller = () =>
  new V1BusinessesController({
    listTenantsByOrganizationId: async () => tenants,
    getTenantEnvironment: async () => ConnectionEnvironment.SANDBOX,
  } as unknown as ComplianceOrganizationApplicationService);

const caller = (businessId: string | null): ApiCaller => ({
  apiKeyId: 'key-1',
  applicationId: 'app-1',
  organizationId: 'org-1',
  environment: ConnectionEnvironment.SANDBOX,
  businessId,
  scopes: [ApiKeyScope.LOOKUPS_READ],
  rateLimitPerMin: 120,
});

describe('GET /v1/businesses', () => {
  it('lists every business in the environment for an organisation-wide key', async () => {
    const res = await controller().list(caller(null));
    expect(res.data.businesses.map((b) => b.id)).toEqual(['t-1', 't-2']);
  });

  it('lists only its own business for a key bound to one', async () => {
    const res = await controller().list(caller('t-2'));
    expect(res.data.businesses.map((b) => b.id)).toEqual(['t-2']);
  });
});

describe('GET /v1/me', () => {
  it('says which business a bound key is limited to', () => {
    expect(new V1MeController().me(caller('t-1')).data).toMatchObject({
      businessId: 't-1',
      scope: 'business',
    });
  });

  it('reports an organisation-wide key as such', () => {
    expect(new V1MeController().me(caller(null)).data).toMatchObject({
      businessId: null,
      scope: 'organization',
    });
  });
});
