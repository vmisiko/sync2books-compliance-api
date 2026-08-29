import { randomUUID } from 'crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DASHBOARD_ORGANIZATION_REPO } from '../../shared/tokens';
import type { IDashboardOrganizationRepository } from './ports/dashboard-organization.repository.port';
import type { DashboardOrganization } from '../domain/entities/dashboard-organization.entity';

@Injectable()
export class DashboardOrganizationApplicationService {
  constructor(
    @Inject(DASHBOARD_ORGANIZATION_REPO)
    private readonly repo: IDashboardOrganizationRepository,
  ) {}

  /**
   * Creates a dashboard organization record. Every business created under it
   * shares the one Main API Application configured via
   * MAIN_API_APPLICATION_ID/MAIN_API_API_KEY (getGlobalMainApiCredentials) —
   * there is no per-organization Main API provisioning anymore.
   */
  async create(displayName: string): Promise<DashboardOrganization> {
    const now = new Date();
    return this.repo.save({
      id: randomUUID(),
      displayName,
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
