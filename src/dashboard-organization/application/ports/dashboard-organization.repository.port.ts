import type { DashboardOrganization } from '../../domain/entities/dashboard-organization.entity';

export interface IDashboardOrganizationRepository {
  findById(id: string): Promise<DashboardOrganization | null>;
  save(organization: DashboardOrganization): Promise<DashboardOrganization>;
}
