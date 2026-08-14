import { Injectable, Logger } from '@nestjs/common';
import { DashboardAuthApplicationService } from '../../application/dashboard-auth.application.service';
import { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';
import { DashboardRole } from '../../../shared/domain/enums/dashboard-role.enum';

/** Same dev tenant seeded by ComplianceOrganizationSeed. */
const DEV_MERCHANT_ID = 'merchant-1';
const DEV_PASSWORD = 'DevPassword123!';

const DEV_USERS: Array<{
  email: string;
  displayName: string;
  role: DashboardRole;
}> = [
  {
    email: 'dev@sync2books.local',
    displayName: 'Dev Admin',
    role: DashboardRole.ADMIN,
  },
  {
    email: 'cfo@sync2books.local',
    displayName: 'Dev CFO',
    role: DashboardRole.CFO,
  },
  {
    email: 'accountant@sync2books.local',
    displayName: 'Dev Accountant',
    role: DashboardRole.ACCOUNTANT,
  },
];

@Injectable()
export class DashboardUserSeed {
  private readonly logger = new Logger(DashboardUserSeed.name);

  constructor(
    private readonly auth: DashboardAuthApplicationService,
    private readonly organization: ComplianceOrganizationApplicationService,
  ) {}

  async runIfEmpty(): Promise<void> {
    const tenant =
      await this.organization.getTenantBySync2booksCompanyId(DEV_MERCHANT_ID);
    if (!tenant) {
      this.logger.warn(
        `Skipped dashboard user seed: no tenant for ${DEV_MERCHANT_ID} yet (ComplianceOrganizationSeed should run first).`,
      );
      return;
    }

    for (const user of DEV_USERS) {
      const existing = await this.auth.findByEmail(user.email);
      if (existing) {
        continue;
      }

      await this.auth.createUser({
        email: user.email,
        password: DEV_PASSWORD,
        displayName: user.displayName,
        role: user.role,
        complianceTenantId: tenant.id,
      });

      this.logger.log(
        `Seeded dev dashboard user ${user.email} / ${DEV_PASSWORD} (${user.role}) for tenant ${tenant.id}`,
      );
    }
  }
}
