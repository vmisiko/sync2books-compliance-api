import type { ComplianceBranch } from '../../domain/entities/compliance-branch.entity';

export interface IComplianceBranchRepository {
  findById(id: string): Promise<ComplianceBranch | null>;
  findByTenantAndSync2booksBranchId(
    tenantId: string,
    sync2booksBranchId: string,
  ): Promise<ComplianceBranch | null>;
  listByTenantId(tenantId: string): Promise<ComplianceBranch[]>;
  save(branch: ComplianceBranch): Promise<ComplianceBranch>;
}
