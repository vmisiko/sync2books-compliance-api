import { retrySalesToEtims } from './retry-sales.usecase';
import { ComplianceStatus } from '../../../shared/domain/enums/compliance-status.enum';
import { DocumentType } from '../../../shared/domain/enums/document-type.enum';
import { SourceSystem } from '../../../shared/domain/enums/source-system.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import { ConnectionStatus } from '../../../shared/domain/enums/connection-status.enum';
import type { ComplianceDocument } from '../../domain/entities/compliance-document.entity';

function makeDocument(
  overrides: Partial<ComplianceDocument> = {},
): ComplianceDocument {
  const id = overrides.id ?? 'doc-1';
  return {
    id,
    merchantId: 'merchant-1',
    branchId: 'branch-1',
    sourceSystem: SourceSystem.API,
    sourceDocumentId: `INV-${id}`,
    documentType: DocumentType.SALE,
    documentNumber: `INV-${id}`,
    originalDocumentNumber: null,
    originalSaleId: null,
    sourceInvoiceId: null,
    mainApiSyncItemId: null,
    mainApiSyncBatchId: null,
    attachmentSyncStatus: null,
    attachmentSyncError: null,
    creditNoteDate: null,
    creditNoteReasonCode: null,
    saleDate: '2026-08-14',
    receiptTypeCode: 'S',
    paymentTypeCode: '01',
    invoiceStatusCode: '02',
    currency: 'KES',
    exchangeRate: 1,
    subtotalAmount: 100,
    totalAmount: 100,
    totalTax: 0,
    customerPin: null,
    customerId: null,
    customerName: null,
    customerPhoneNumber: null,
    customerEmail: null,
    complianceStatus: ComplianceStatus.REJECTED,
    submissionAttempts: 1,
    etimsReceiptNumber: null,
    totRcptNo: null,
    sdcDateTime: null,
    receiptLabel: null,
    oscuInvcNo: null,
    idempotencyKey: `idem-${id}`,
    createdAt: new Date('2026-08-14T10:00:00Z'),
    submittedAt: null,
    lines: [
      {
        id: `line-${id}`,
        documentId: id,
        itemId: 'item-1',
        etimsItemCodeSnapshot: 'IT001',
        description: 'Line',
        quantity: 1,
        unitPrice: 100,
        taxCategory: TaxCategory.VAT_STANDARD,
        taxAmount: 0,
        classificationCodeSnapshot: '14111400',
        unitCodeSnapshot: 'U',
        packagingUnitCodeSnapshot: 'NT',
        taxTyCdSnapshot: 'B',
        productTypeCodeSnapshot: '2',
        createdAt: new Date('2026-08-14T10:00:00Z'),
      },
    ],
    ...overrides,
  };
}

/** In-memory documentRepo stand-in so save()/findByMerchant() observe each
 * other's effects (needed since submitDocument itself calls save/findById). */
function makeDocumentRepo(initial: ComplianceDocument[]) {
  const store = new Map(initial.map((d) => [d.id, d]));
  return {
    save: jest.fn().mockImplementation((d: ComplianceDocument) => {
      store.set(d.id, d);
      return Promise.resolve(d);
    }),
    findById: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(store.get(id) ?? null),
      ),
    findByIdempotencyKey: jest.fn().mockResolvedValue(null),
    findBySourceInvoiceId: jest.fn().mockResolvedValue(null),
    findByMerchant: jest
      .fn()
      .mockImplementation((merchantId: string) =>
        Promise.resolve(
          [...store.values()].filter((d) => d.merchantId === merchantId),
        ),
      ),
    _store: store,
  };
}

function makeConnectionRepo() {
  return {
    findByMerchantAndBranch: jest.fn().mockResolvedValue({
      merchantId: 'merchant-1',
      branchId: 'branch-1',
      kraPin: 'P000000000A',
      kraBhfId: '00',
      cmcKey: 'cmc-key',
      deviceId: 'device-1',
      environment: 'SANDBOX',
      status: ConnectionStatus.ACTIVE,
    }),
  };
}

function makeEventRepo() {
  return {
    append: jest.fn().mockResolvedValue(undefined),
    findByDocumentId: jest.fn().mockResolvedValue([]),
  };
}

function makeSyncStateRepo() {
  const store = new Map<string, string>();
  return {
    findOne: jest
      .fn()
      .mockImplementation(({ where: { syncKey } }) =>
        Promise.resolve(
          store.has(syncKey)
            ? { syncKey, lastReqDt: store.get(syncKey) }
            : null,
        ),
      ),
    upsert: jest.fn().mockImplementation(({ syncKey, lastReqDt }) => {
      store.set(syncKey, lastReqDt);
      return Promise.resolve(undefined);
    }),
  };
}

/**
 * Stands in for the SalesService methods retrySalesToEtims now delegates the
 * DRAFT -> VALIDATED -> READY_FOR_SUBMISSION walk to. Advances status in the
 * same in-memory store the document repo reads from, so the use case observes
 * a real status change between steps exactly as it does in production.
 */
function makePipeline(documentRepo: ReturnType<typeof makeDocumentRepo>) {
  const advance = (id: string, to: ComplianceStatus) => {
    const doc = documentRepo._store.get(id)!;
    documentRepo._store.set(id, { ...doc, complianceStatus: to });
  };
  return {
    applyInventoryMovements: jest.fn().mockResolvedValue(undefined),
    validateDocument: jest.fn().mockImplementation((id: string) => {
      advance(id, ComplianceStatus.VALIDATED);
      return Promise.resolve({ validation: { isValid: true, errors: [] } });
    }),
    prepareDocument: jest.fn().mockImplementation((id: string) => {
      advance(id, ComplianceStatus.READY_FOR_SUBMISSION);
      return Promise.resolve(undefined);
    }),
    // No-op here: its own behaviour is covered by
    // refresh-line-oscu-codes.usecase.spec.ts. What matters for these tests
    // is only that the retry pipeline calls it before every submit.
    refreshLineOscuCodes: jest.fn().mockResolvedValue(undefined),
  };
}

describe('retrySalesToEtims', () => {
  it('retries every status the dashboard shows as actionable, DRAFT and VALIDATED included', async () => {
    const rejected = makeDocument({
      id: 'doc-rejected',
      complianceStatus: ComplianceStatus.REJECTED,
    });
    const draft = makeDocument({
      id: 'doc-draft',
      complianceStatus: ComplianceStatus.DRAFT,
    });
    const validated = makeDocument({
      id: 'doc-validated',
      complianceStatus: ComplianceStatus.VALIDATED,
    });

    const documentRepo = makeDocumentRepo([rejected, draft, validated]);
    const connectionRepo = makeConnectionRepo();
    const eventRepo = makeEventRepo();
    const etimsAdapter = {
      submitInvoice: jest
        .fn()
        .mockResolvedValue({ success: true, receiptNumber: 'RCPT-1' }),
    };
    const syncStateRepo = makeSyncStateRepo();
    const pipeline = makePipeline(documentRepo);

    const result = await retrySalesToEtims(
      { merchantId: 'merchant-1' },
      {
        documentRepo: documentRepo as any,
        connectionRepo: connectionRepo as any,
        eventRepo: eventRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
        ...pipeline,
      },
    );

    expect(result.attempted).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(etimsAdapter.submitInvoice).toHaveBeenCalledTimes(3);

    // DRAFT took the full walk; VALIDATED skipped straight to prepare.
    expect(pipeline.validateDocument).toHaveBeenCalledTimes(1);
    expect(pipeline.validateDocument).toHaveBeenCalledWith('doc-draft');
    expect(pipeline.prepareDocument).toHaveBeenCalledTimes(2);
    expect(pipeline.applyInventoryMovements).toHaveBeenCalledTimes(1);
    expect(pipeline.applyInventoryMovements).toHaveBeenCalledWith('doc-draft');
  });

  // The live symptom this endpoint was reported for: the dashboard renders a
  // DRAFT sale as "ready_to_submit" and offers "Submit to KRA", so a retry
  // targeting it by id must actually submit -- not answer
  // `{attempted: 0, results: []}` with nothing sent and nothing logged.
  it('submits a DRAFT sale targeted by id instead of silently returning attempted=0', async () => {
    const draft = makeDocument({
      id: 'doc-draft',
      complianceStatus: ComplianceStatus.DRAFT,
    });

    const documentRepo = makeDocumentRepo([draft]);
    const connectionRepo = makeConnectionRepo();
    const eventRepo = makeEventRepo();
    const etimsAdapter = {
      submitInvoice: jest
        .fn()
        .mockResolvedValue({ success: true, receiptNumber: 'RCPT-7' }),
    };
    const syncStateRepo = makeSyncStateRepo();
    const pipeline = makePipeline(documentRepo);

    const result = await retrySalesToEtims(
      { merchantId: 'merchant-1', documentIds: ['doc-draft'] },
      {
        documentRepo: documentRepo as any,
        connectionRepo: connectionRepo as any,
        eventRepo: eventRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
        ...pipeline,
      },
    );

    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.results[0].receiptNumber).toBe('RCPT-7');
    expect(etimsAdapter.submitInvoice).toHaveBeenCalledTimes(1);
    expect(documentRepo._store.get('doc-draft')!.complianceStatus).toBe(
      ComplianceStatus.ACCEPTED,
    );
  });

  it('reports a requested document that is not retryable rather than omitting it', async () => {
    const accepted = makeDocument({
      id: 'doc-accepted',
      complianceStatus: ComplianceStatus.ACCEPTED,
    });

    const documentRepo = makeDocumentRepo([accepted]);
    const connectionRepo = makeConnectionRepo();
    const eventRepo = makeEventRepo();
    const etimsAdapter = { submitInvoice: jest.fn() };
    const syncStateRepo = makeSyncStateRepo();
    const pipeline = makePipeline(documentRepo);

    const result = await retrySalesToEtims(
      { merchantId: 'merchant-1', documentIds: ['doc-accepted'] },
      {
        documentRepo: documentRepo as any,
        connectionRepo: connectionRepo as any,
        eventRepo: eventRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
        ...pipeline,
      },
    );

    expect(result.attempted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain('ACCEPTED');
    expect(etimsAdapter.submitInvoice).not.toHaveBeenCalled();
  });

  it('reports a requested document that does not belong to the merchant', async () => {
    const documentRepo = makeDocumentRepo([]);
    const connectionRepo = makeConnectionRepo();
    const eventRepo = makeEventRepo();
    const etimsAdapter = { submitInvoice: jest.fn() };
    const syncStateRepo = makeSyncStateRepo();
    const pipeline = makePipeline(documentRepo);

    const result = await retrySalesToEtims(
      { merchantId: 'merchant-1', documentIds: ['doc-missing'] },
      {
        documentRepo: documentRepo as any,
        connectionRepo: connectionRepo as any,
        eventRepo: eventRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
        ...pipeline,
      },
    );

    expect(result.attempted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain('was not found');
    expect(etimsAdapter.submitInvoice).not.toHaveBeenCalled();
  });

  it('skips already-ACCEPTED/SUBMITTED documents', async () => {
    const accepted = makeDocument({
      id: 'doc-accepted',
      complianceStatus: ComplianceStatus.ACCEPTED,
    });
    const submitted = makeDocument({
      id: 'doc-submitted',
      complianceStatus: ComplianceStatus.SUBMITTED,
    });

    const documentRepo = makeDocumentRepo([accepted, submitted]);
    const connectionRepo = makeConnectionRepo();
    const eventRepo = makeEventRepo();
    const etimsAdapter = { submitInvoice: jest.fn() };
    const syncStateRepo = makeSyncStateRepo();
    const pipeline = makePipeline(documentRepo);

    const result = await retrySalesToEtims(
      { merchantId: 'merchant-1' },
      {
        documentRepo: documentRepo as any,
        connectionRepo: connectionRepo as any,
        eventRepo: eventRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
        ...pipeline,
      },
    );

    expect(result.attempted).toBe(0);
    expect(result.results).toEqual([]);
    expect(etimsAdapter.submitInvoice).not.toHaveBeenCalled();
  });

  it('transitions REJECTED -> RETRYING -> SUBMITTED -> ACCEPTED and aggregates success/failure counts', async () => {
    const willSucceed = makeDocument({
      id: 'doc-ok',
      complianceStatus: ComplianceStatus.REJECTED,
    });
    const willFail = makeDocument({
      id: 'doc-fail',
      complianceStatus: ComplianceStatus.FAILED,
    });

    const documentRepo = makeDocumentRepo([willSucceed, willFail]);
    const connectionRepo = makeConnectionRepo();
    const eventRepo = makeEventRepo();
    const etimsAdapter = {
      submitInvoice: jest.fn().mockImplementation((payload) => {
        if (payload.documentNumber === willSucceed.documentNumber) {
          return Promise.resolve({ success: true, receiptNumber: 'RCPT-9' });
        }
        return Promise.resolve({
          success: false,
          error: 'KRA rejected: invalid TIN',
        });
      }),
    };
    const syncStateRepo = makeSyncStateRepo();
    const pipeline = makePipeline(documentRepo);

    const result = await retrySalesToEtims(
      { merchantId: 'merchant-1' },
      {
        documentRepo: documentRepo as any,
        connectionRepo: connectionRepo as any,
        eventRepo: eventRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
        ...pipeline,
      },
    );

    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);

    const okResult = result.results.find((r) => r.documentId === 'doc-ok')!;
    expect(okResult.success).toBe(true);
    expect(okResult.status).toBe(ComplianceStatus.ACCEPTED);
    expect(okResult.receiptNumber).toBe('RCPT-9');

    const failResult = result.results.find((r) => r.documentId === 'doc-fail')!;
    expect(failResult.success).toBe(false);
    expect(failResult.status).toBe(ComplianceStatus.REJECTED);
    expect(failResult.error).toContain('invalid TIN');

    // FAILED went through RETRYING on its way to the final REJECTED outcome.
    expect(documentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'doc-fail',
        complianceStatus: ComplianceStatus.RETRYING,
      }),
    );
  });

  it('respects explicit documentIds when provided, ignoring other retryable documents', async () => {
    const targeted = makeDocument({
      id: 'doc-targeted',
      complianceStatus: ComplianceStatus.REJECTED,
    });
    const other = makeDocument({
      id: 'doc-other',
      complianceStatus: ComplianceStatus.REJECTED,
    });

    const documentRepo = makeDocumentRepo([targeted, other]);
    const connectionRepo = makeConnectionRepo();
    const eventRepo = makeEventRepo();
    const etimsAdapter = {
      submitInvoice: jest
        .fn()
        .mockResolvedValue({ success: true, receiptNumber: 'RCPT-1' }),
    };
    const syncStateRepo = makeSyncStateRepo();
    const pipeline = makePipeline(documentRepo);

    const result = await retrySalesToEtims(
      { merchantId: 'merchant-1', documentIds: ['doc-targeted'] },
      {
        documentRepo: documentRepo as any,
        connectionRepo: connectionRepo as any,
        eventRepo: eventRepo as any,
        etimsAdapter: etimsAdapter as any,
        syncStateRepo: syncStateRepo as any,
        ...pipeline,
      },
    );

    expect(result.attempted).toBe(1);
    expect(result.results[0].documentId).toBe('doc-targeted');
    expect(documentRepo._store.get('doc-other')!.complianceStatus).toBe(
      ComplianceStatus.REJECTED,
    );
  });
});
