import { Injectable, Logger } from '@nestjs/common';
import { DashboardAuthApplicationService } from '../../application/dashboard-auth.application.service';
import { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';
import { DashboardRole } from '../../../shared/domain/enums/dashboard-role.enum';

/** Same dev tenant seeded by ComplianceOrganizationSeed. */
const DEV_MERCHANT_ID = 'merchant-1';
const DEV_EMAIL = 'dev@sync2books.local';
const DEV_PASSWORD = 'DevPassword123!';

@Injectable()
export class DashboardUserSeed {
  private readonly logger = new Logger(DashboardUserSeed.name);

  constructor(
    private readonly auth: DashboardAuthApplicationService,
    private readonly organization: ComplianceOrganizationApplicationService,
  ) {}

  async runIfEmpty(): Promise<void> {
    const existing = await this.auth.findByEmail(DEV_EMAIL);
    if (existing) {
      return;
    }

    const tenant = await this.organization.getTenantBySync2booksCompanyId(DEV_MERCHANT_ID);
    if (!tenant) {
      this.logger.warn(
        `Skipped dashboard user seed: no tenant for ${DEV_MERCHANT_ID} yet (ComplianceOrganizationSeed should run first).`,
      );
      return;
    }

    await this.auth.createUser({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      displayName: 'Dev Admin',
      role: DashboardRole.ADMIN,
      complianceTenantId: tenant.id,
    });

    this.logger.log(`Seeded dev dashboard user ${DEV_EMAIL} / ${DEV_PASSWORD} for tenant ${tenant.id}`);
  }
}
