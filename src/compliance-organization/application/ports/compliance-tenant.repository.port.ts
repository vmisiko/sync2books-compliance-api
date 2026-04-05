import type { ComplianceTenant } from '../../domain/entities/compliance-tenant.entity';

export interface IComplianceTenantRepository {
  findById(id: string): Promise<ComplianceTenant | null>;
  findBySync2booksCompanyId(
    sync2booksCompanyId: string,
  ): Promise<ComplianceTenant | null>;
  save(tenant: ComplianceTenant): Promise<ComplianceTenant>;
}
