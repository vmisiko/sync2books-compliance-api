import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateDocumentInput,
  CreateDocumentResult,
} from './use-cases/create-document.usecase';
import { createDocument as createDocumentUseCase } from './use-cases/create-document.usecase';
import { prepareDocument as prepareDocumentUseCase } from './use-cases/prepare-document.usecase';
import { submitDocument as submitDocumentUseCase } from './use-cases/submit-document.usecase';
import { validateDocument as validateDocumentUseCase } from './use-cases/validate-document.usecase';
import type { IEtimsAdapter } from '../../regulatory/oscu/ports/etims-adapter.port';
import { canTransition } from '../domain/state-machine/compliance-state-machine';
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import type { ComplianceDocument } from '../domain/entities/compliance-document.entity';
import type {
  IComplianceConnectionRepository,
  IComplianceDocumentRepository,
  IComplianceEventRepository,
  IComplianceItemRepository,
} from '../../shared/ports/repository.port';
import {
  CONNECTION_REPO,
  DOCUMENT_REPO,
  ETIMS_ADAPTER,
  EVENT_REPO,
  ITEM_REPO,
} from '../../shared/tokens';

/**
 * Sales (Documents) application service.
 *
 * Owns document lifecycle endpoints:
 * create → validate → prepare → submit
 */
@Injectable()
export class SalesService {
  constructor(
    @Inject(DOCUMENT_REPO)
    private readonly documentRepo: IComplianceDocumentRepository,
    @Inject(EVENT_REPO)
    private readonly eventRepo: IComplianceEventRepository,
    @Inject(ITEM_REPO)
    private readonly itemRepo: IComplianceItemRepository,
    @Inject(CONNECTION_REPO)
    private readonly connectionRepo: IComplianceConnectionRepository,
    @Inject(ETIMS_ADAPTER)
    private readonly etimsAdapter: IEtimsAdapter,
  ) {}

  async createDocument(
    params: CreateDocumentInput,
    options?: { enqueueProcessing?: boolean },
  ): Promise<CreateDocumentResult> {
    const result: CreateDocumentResult = await createDocumentUseCase(
      params,
      this.documentRepo,
      this.itemRepo,
      this.eventRepo,
    );

    // Fire-and-forget processing: validate → prepare → submit
    // Client can poll `GET /documents/:id` to see status.
    if (result.created && options?.enqueueProcessing !== false) {
      const documentId: string = (result.document as { id: string }).id;
      this.enqueueDocumentProcessing(documentId);
    }

    return result;
  }

  async getDocument(
    documentId: string,
  ): Promise<{ document: ComplianceDocument }> {
    const document: ComplianceDocument | null =
      await this.documentRepo.findById(documentId);
    if (!document) throw new Error(`Document ${documentId} not found`);
    return { document };
  }

  async listDocuments(
    merchantId: string,
  ): Promise<{ documents: ComplianceDocument[] }> {
    const repo = this.documentRepo as unknown as {
      findByMerchant: (m: string) => Promise<ComplianceDocument[]>;
    };
    const documents = await repo.findByMerchant(merchantId);
    return { documents };
  }

  async validateDocument(documentId: string) {
    return validateDocumentUseCase(
      documentId,
      this.documentRepo,
      this.itemRepo,
      this.eventRepo,
    );
  }

  async prepareDocument(documentId: string) {
    return prepareDocumentUseCase(
      documentId,
      this.documentRepo,
      this.itemRepo,
      this.eventRepo,
    );
  }

  async submitDocument(documentId: string) {
    return submitDocumentUseCase(
      documentId,
      this.documentRepo,
      this.connectionRepo,
      this.eventRepo,
      this.etimsAdapter,
    );
  }

  private enqueueDocumentProcessing(documentId: string): void {
    setImmediate(() => {
      void this.processDocumentInBackground(documentId);
    });
  }

  private async processDocumentInBackground(documentId: string): Promise<void> {
    try {
      const validation = await this.validateDocument(documentId);
      if (!validation.transitioned) {
        await this.eventRepo.append({
          id: `evt-${documentId}-valfail-${Date.now()}`,
          documentId,
          eventType: 'VALIDATION_FAILED',
          payloadSnapshot: { validation: validation.validation },
          responseSnapshot: null,
          createdAt: new Date(),
        });
        return;
      }

      await this.prepareDocument(documentId);

      await this.submitDocument(documentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      await this.eventRepo.append({
        id: `evt-${documentId}-failed-${Date.now()}`,
        documentId,
        eventType: 'FAILED',
        payloadSnapshot: { error: message },
        responseSnapshot: null,
        createdAt: new Date(),
      });

      // Best-effort transition to FAILED when allowed by state machine.
      const current = await this.documentRepo.findById(documentId);
      if (
        current &&
        canTransition(current.complianceStatus, ComplianceStatus.FAILED)
      ) {
        await this.documentRepo.save({
          ...current,
          complianceStatus: ComplianceStatus.FAILED,
        });
      }
    }
  }
}
