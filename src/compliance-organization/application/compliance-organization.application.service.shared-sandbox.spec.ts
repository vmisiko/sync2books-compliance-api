import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectionEnvironment } from '../../shared/domain/enums/connection-environment.enum';
import { ComplianceOrganizationModule } from '../compliance-organization.module';
import { ComplianceOrganizationApplicationService } from './compliance-organization.application.service';

const SHARED_ENV = {
  ETIMS_SANDBOX_SHARED_KRA_PIN: 'P000000000S',
  ETIMS_SANDBOX_SHARED_DVC_SRL_NO: 'SHARED-SERIAL',
  ETIMS_SANDBOX_SHARED_DEVICE_ID: 'shared-device',
  ETIMS_SANDBOX_SHARED_CMC_KEY: 'shared-cmc-key',
};

/**
 * Regression: re-upserting an existing tenant without a kraPin (what
 * MainApiConnectionApplicationService.ensureCompany() does) used to apply the
 * ETIMS_SANDBOX_SHARED_* credentials over an already-initialized connection.
 */
describe('ComplianceOrganizationApplicationService shared sandbox credentials', () => {
  let service: ComplianceOrganizationApplicationService;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const k of Object.keys(SHARED_ENV)) saved[k] = process.env[k];
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          autoLoadEntities: true,
          synchronize: true,
          logging: false,
        }),
        ComplianceOrganizationModule,
      ],
    }).compile();
    await module.init();
    service = module.get(ComplianceOrganizationApplicationService);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function createInitializedTenant() {
    const { tenant, defaultBranchId } = await service.upsertTenant({
      kraPin: 'P600004862A',
      environment: ConnectionEnvironment.SANDBOX,
    });
    // Same write initializeEtimsConnection performs after OSCU /initialize.
    await service.upsertEtimsConnection({
      complianceBranchId: defaultBranchId,
      kraPin: 'P600004862A',
      environment: ConnectionEnvironment.SANDBOX,
      dvcSrlNo: 'OWN-SERIAL',
      deviceId: '451710',
      cmcKey: 'own-cmc-key',
    });
    return { tenant, defaultBranchId };
  }

  it('does not overwrite an initialized connection when an existing tenant is re-upserted by id without kraPin', async () => {
    const { tenant, defaultBranchId } = await createInitializedTenant();
    Object.assign(process.env, SHARED_ENV);

    const result = await service.upsertTenant({
      id: tenant.id,
      sync2booksCompanyId: 'main-api-company-1',
    });

    expect(result.etimsConnection).toBeNull();
    const summary = await service.getTenantSummary(tenant.id);
    expect(summary?.etimsConnection).toMatchObject({
      kraPin: 'P600004862A',
      dvcSrlNo: 'OWN-SERIAL',
      deviceId: '451710',
      cmcKey: 'own-cmc-key',
    });
    expect(summary?.branch.id).toBe(defaultBranchId);
  });

  it('does not overwrite when the existing tenant is matched by sync2booksCompanyId', async () => {
    const { tenant } = await createInitializedTenant();
    await service.upsertTenant({
      id: tenant.id,
      sync2booksCompanyId: 'main-api-company-2',
    });
    Object.assign(process.env, SHARED_ENV);

    await service.upsertTenant({ sync2booksCompanyId: 'main-api-company-2' });

    const summary = await service.getTenantSummary(tenant.id);
    expect(summary?.etimsConnection?.kraPin).toBe('P600004862A');
    expect(summary?.etimsConnection?.deviceId).toBe('451710');
    expect(summary?.etimsConnection?.cmcKey).toBe('own-cmc-key');
  });

  it('still seeds shared credentials on a brand-new sandbox tenant with no kraPin', async () => {
    Object.assign(process.env, SHARED_ENV);

    const { tenant } = await service.upsertTenant({
      sync2booksCompanyId: 'main-api-company-3',
    });

    const summary = await service.getTenantSummary(tenant.id);
    expect(summary?.etimsConnection).toMatchObject({
      kraPin: 'P000000000S',
      dvcSrlNo: 'SHARED-SERIAL',
      deviceId: 'shared-device',
      cmcKey: 'shared-cmc-key',
    });
  });
});
