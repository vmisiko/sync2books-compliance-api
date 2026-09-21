import type { ComplianceApiKey } from '../../domain/entities/compliance-api-key.entity';

export interface IComplianceApiKeyRepository {
  findByHash(keyHash: string): Promise<ComplianceApiKey | null>;
  findById(id: string): Promise<ComplianceApiKey | null>;
  findByApplicationId(applicationId: string): Promise<ComplianceApiKey[]>;
  save(key: ComplianceApiKey): Promise<ComplianceApiKey>;
  /**
   * Fire-and-forget touch of `lastUsedAt` on the authentication path. Separate
   * from `save` so a failure here can be swallowed: knowing when a key was last
   * used is useful, but not worth failing a request the caller was entitled to
   * make.
   */
  touchLastUsedAt(id: string, at: Date): Promise<void>;
}
