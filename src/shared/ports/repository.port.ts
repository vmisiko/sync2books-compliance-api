import type { ComplianceConnection } from '../domain/entities/compliance-connection.entity';
import type { ComplianceItem } from '../domain/entities/compliance-item.entity';
import type { ComplianceDocument } from '../../sales/domain/entities/compliance-document.entity';
import type { ComplianceEvent } from '../../sales/domain/entities/compliance-event.entity';

export interface IComplianceDocumentRepository {
  save(document: ComplianceDocument): Promise<ComplianceDocument>;
  findById(id: string): Promise<ComplianceDocument | null>;
  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ComplianceDocument | null>;
  findByMerchant(merchantId: string): Promise<ComplianceDocument[]>;
}

export interface IComplianceEventRepository {
  append(event: ComplianceEvent): Promise<ComplianceEvent>;
  findByDocumentId(documentId: string): Promise<ComplianceEvent[]>;
}

export interface IComplianceItemRepository {
  findByIds(ids: string[]): Promise<ComplianceItem[]>;
}

export interface IComplianceConnectionRepository {
  findByMerchantAndBranch(
    merchantId: string,
    branchId: string,
  ): Promise<ComplianceConnection | null>;
}
