import { Injectable, Logger } from '@nestjs/common';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { ComplianceOrganizationApplicationService } from '../../application/compliance-organization.application.service';

const DEV_MERCHANT_ID = 'merchant-1';
const DEV_BRANCH_ID = 'branch-1';

@Injectable()
export class ComplianceOrganizationSeed {
  private readonly logger = new Logger(ComplianceOrganizationSeed.name);

  constructor(
    private readonly organization: ComplianceOrganizationApplicationService,
  ) {}

  /**
   * Dev-only bootstrap fixture — seeds a "Dev merchant" tenant with a
   * placeholder SANDBOX eTIMS connection (kraPin 'P1234567890', cmcKey
   * 'cmc-key-stub') so a fresh local DB has something to work against.
   * Gated on NODE_ENV (the Dockerfile sets it to 'production' for every
   * real deploy) because this fixture previously leaked into shared/
   * production-like environments: MainApiConnectionApplicationService's
   * OSCU reference-data cron just grabs *any* ACTIVE SANDBOX connection to
   * authenticate its pull, with no way to prefer a real credential over
   * this fixture's, so it kept picking the fake one and getting rejected
   * by KRA with "The tin you provided does not meet the required tin
   * format" instead of the real ETIMS_SANDBOX_SHARED_KRA_PIN connection.
   */
  async runIfEmpty(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      this.logger.log('Skipping dev merchant seed: NODE_ENV=production');
      return;
    }
    const existing =
      await this.organization.getTenantBySync2booksCompanyId(DEV_MERCHANT_ID);
    if (existing) {
      return;
    }
    const { tenant } = await this.organization.upsertTenant({
      sync2booksCompanyId: DEV_MERCHANT_ID,
      displayName: 'Dev merchant',
    });
    const listed = await this.organization.listBranches(tenant.id);
    const first = listed[0];
    if (!first) {
      throw new Error('Expected default branch after tenant creation');
    }
    const branch = await this.organization.upsertBranch({
      tenantId: tenant.id,
      id: first.id,
      sync2booksBranchId: DEV_BRANCH_ID,
      displayName: 'Main branch',
    });
    await this.organization.upsertEtimsConnection({
      complianceBranchId: branch.id,
      kraPin: 'P1234567890',
      deviceId: 'device-1',
      cmcKey: 'cmc-key-stub',
      environment: ConnectionEnvironment.SANDBOX,
    });
  }
}
