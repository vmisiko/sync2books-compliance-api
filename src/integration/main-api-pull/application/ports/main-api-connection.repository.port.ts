import type { MainApiConnection } from '../../domain/entities/main-api-connection.entity';

export interface IMainApiConnectionRepository {
  findByTenantId(complianceTenantId: string): Promise<MainApiConnection | null>;
  save(connection: MainApiConnection): Promise<MainApiConnection>;
}
