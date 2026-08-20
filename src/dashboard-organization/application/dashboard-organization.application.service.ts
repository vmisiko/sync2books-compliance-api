import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DASHBOARD_ORGANIZATION_REPO } from '../../shared/tokens';
import type { IDashboardOrganizationRepository } from './ports/dashboard-organization.repository.port';
import type { DashboardOrganization } from '../domain/entities/dashboard-organization.entity';
import { MainApiAuthClient } from '../infrastructure/http/main-api-auth.client';

export type ProvisionOrganizationInput = {
  displayName: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
};

@Injectable()
export class DashboardOrganizationApplicationService {
  private readonly logger = new Logger(DashboardOrganizationApplicationService.name);

  constructor(
    @Inject(DASHBOARD_ORGANIZATION_REPO)
    private readonly repo: IDashboardOrganizationRepository,
    private readonly mainApiAuth: MainApiAuthClient,
  ) {}

  /**
   * Real signup path: creates a real Organization + Application on the main
   * API (auto-provisioning what a human previously had to paste into the ERP
   * Connection settings page by hand), then stores the resulting apiKey here
   * for reuse across every business this org creates.
   */
  async provisionForSignup(
    input: ProvisionOrganizationInput,
  ): Promise<DashboardOrganization> {
    // Best-effort: a signup must always succeed even if the main API (or its
    // Application/credentials provisioning) is unavailable or misbehaving —
    // this lands the org with a null apiKey, same state as createLocal(),
    // and ERP-linking/business creation degrades gracefully until an apiKey
    // is available (see MainApiConnectionApplicationService callers, which
    // already check for a present apiKey before attempting anything).
    let mainApiOrganizationId: string | null = null;
    let mainApiApplicationId: string | null = null;
    let mainApiApiKey: string | null = null;

    try {
      const signup = await this.mainApiAuth.signUp({
        firstName: input.adminFirstName,
        lastName: input.adminLastName,
        email: input.adminEmail,
        password: input.adminPassword,
        organizationName: input.displayName,
      });
      mainApiOrganizationId = signup.organizationId;

      const application = await this.mainApiAuth.createApplication(
        signup.organizationId,
        'Sync2Books Compliance Dashboard',
      );
      mainApiApplicationId = application.applicationId;
      mainApiApiKey = application.apiKey;
    } catch (error) {
      this.logger.warn(
        `Main-API auto-provisioning failed for "${input.displayName}" — continuing with a local-only organization: ${(error as Error).message}`,
      );
    }

    const now = new Date();
    return this.repo.save({
      id: randomUUID(),
      displayName: input.displayName,
      mainApiOrganizationId,
      mainApiApplicationId,
      mainApiApiKey,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Dev-seed-only: an org with no real main-API signup behind it (mainApiApiKey stays null until someone completes ERP Connection setup manually). */
  async createLocal(displayName: string): Promise<DashboardOrganization> {
    const now = new Date();
    return this.repo.save({
      id: randomUUID(),
      displayName,
      mainApiOrganizationId: null,
      mainApiApplicationId: null,
      mainApiApiKey: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async getById(id: string): Promise<DashboardOrganization> {
    const org = await this.repo.findById(id);
    if (!org) {
      throw new NotFoundException(`Organization ${id} not found`);
    }
    return org;
  }

  async updateDisplayName(
    id: string,
    displayName: string,
  ): Promise<DashboardOrganization> {
    const org = await this.getById(id);
    return this.repo.save({
      ...org,
      displayName,
      updatedAt: new Date(),
    });
  }
}
