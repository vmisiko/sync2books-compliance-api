import type { ComplianceConnection } from '../domain/entities/compliance-connection.entity';
import type { ConnectionEnvironment } from '../domain/enums/connection-environment.enum';
import type { ComplianceItem } from '../domain/entities/compliance-item.entity';
import type { ComplianceDocument } from '../../sales/domain/entities/compliance-document.entity';
import type { ComplianceEvent } from '../../sales/domain/entities/compliance-event.entity';

export interface IComplianceDocumentRepository {
  save(document: ComplianceDocument): Promise<ComplianceDocument>;
  findById(id: string): Promise<ComplianceDocument | null>;
  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ComplianceDocument | null>;
  findBySourceInvoiceId(
    merchantId: string,
    sourceInvoiceId: string,
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
  /**
   * Any one active connection in this environment — used by the scheduled
   * OSCU reference-data sync (code list, item classifications), which is
   * environment-wide, not merchant-scoped, and just needs a valid
   * kraPin/kraBhfId/cmcKey to authenticate the pull.
   */
  findAnyConnected(
    environment: ConnectionEnvironment,
  ): Promise<ComplianceConnection | null>;
}
