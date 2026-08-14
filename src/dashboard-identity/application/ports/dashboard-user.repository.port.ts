import type { DashboardUser } from '../../domain/entities/dashboard-user.entity';

export interface IDashboardUserRepository {
  findById(id: string): Promise<DashboardUser | null>;
  findByEmail(email: string): Promise<DashboardUser | null>;
  save(user: DashboardUser): Promise<DashboardUser>;
}
