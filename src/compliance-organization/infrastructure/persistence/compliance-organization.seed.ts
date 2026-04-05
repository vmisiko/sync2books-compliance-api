import { Injectable } from '@nestjs/common';
import { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { ComplianceOrganizationApplicationService } from '../../application/compliance-organization.application.service';

const DEV_MERCHANT_ID = 'merchant-1';
const DEV_BRANCH_ID = 'branch-1';

@Injectable()
export class ComplianceOrganizationSeed {
  constructor(
    private readonly organization: ComplianceOrganizationApplicationService,
  ) {}

  async runIfEmpty(): Promise<void> {
    const existing =
      await this.organization.getTenantBySync2booksCompanyId(DEV_MERCHANT_ID);
    if (existing) {
      return;
    }
    const tenant = await this.organization.upsertTenant({
      sync2booksCompanyId: DEV_MERCHANT_ID,
      displayName: 'Dev merchant',
    });
    const branch = await this.organization.upsertBranch({
      tenantId: tenant.id,
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
