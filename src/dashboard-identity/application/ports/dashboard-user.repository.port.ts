import type { DashboardUser } from '../../domain/entities/dashboard-user.entity';

export interface IDashboardUserRepository {
  findById(id: string): Promise<DashboardUser | null>;
  findByEmail(email: string): Promise<DashboardUser | null>;
  listByOrganizationId(organizationId: string): Promise<DashboardUser[]>;
  save(user: DashboardUser): Promise<DashboardUser>;
}
