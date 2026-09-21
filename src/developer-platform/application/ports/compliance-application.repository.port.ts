import type { ComplianceApplication } from '../../domain/entities/compliance-application.entity';

export interface IComplianceApplicationRepository {
  findById(id: string): Promise<ComplianceApplication | null>;
  findByOrganizationId(organizationId: string): Promise<ComplianceApplication[]>;
  save(application: ComplianceApplication): Promise<ComplianceApplication>;
  delete(id: string): Promise<void>;
}
