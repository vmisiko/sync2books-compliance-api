import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { OscuSyncStateOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';
import {
  OSCU_TAX_RATE_BY_TAX_TY_CD,
  oscuTaxRateForCode,
} from '../../regulatory/oscu/mapping/oscu-tax-rates';
import type {
  CreateDocumentInput,
  CreateDocumentResult,
} from './use-cases/create-document.usecase';
import { createDocument as createDocumentUseCase } from './use-cases/create-document.usecase';
import { prepareDocument as prepareDocumentUseCase } from './use-cases/prepare-document.usecase';
import { submitDocument as submitDocumentUseCase } from './use-cases/submit-document.usecase';
import { validateDocument as validateDocumentUseCase } from './use-cases/validate-document.usecase';
import {
  retrySalesToEtims,
  type RetrySalesInput,
  type RetrySalesResult,
} from './use-cases/retry-sales.usecase';
import type { IEtimsAdapter } from '../../regulatory/oscu/ports/etims-adapter.port';
import { canTransition } from '../domain/state-machine/compliance-state-machine';
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import type { ComplianceDocument } from '../domain/entities/compliance-document.entity';
import type { ComplianceEvent } from '../domain/entities/compliance-event.entity';
import {
  deriveItemType,
  type ComplianceItem,
} from '../../shared/domain/entities/compliance-item.entity';
import { ItemType } from '../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';
import type { ComplianceConnection } from '../../shared/domain/entities/compliance-connection.entity';
import { InventoryService } from '../../inventory/api/inventory.service';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { MovementType } from '../../inventory/domain/enums/movement-type.enum';
import { DocumentType } from '../../shared/domain/enums/document-type.enum';
import { generateEtimsReceiptPdf } from './receipt/etims-receipt-pdf.generator';
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
    private readonly inventoryService: InventoryService,
    @InjectRepository(OscuSyncStateOrmEntity)
    private readonly syncStateRepo: Repository<OscuSyncStateOrmEntity>,
    private readonly organizationService: ComplianceOrganizationApplicationService,
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

  /**
   * Looks up the document created from a given Main-API `Invoice` id, scoped
   * to a merchant. Backs the dashboard's receipt-attachment-status/
   * retry-receipt-attachment proxy routes (see `DashboardInvoicesApplicationService`).
   */
  async getDocumentBySourceInvoiceId(
    merchantId: string,
    sourceInvoiceId: string,
  ): Promise<ComplianceDocument | null> {
    return this.documentRepo.findBySourceInvoiceId(merchantId, sourceInvoiceId);
  }

  /**
   * Backfills `sourceInvoiceId` onto a document that already existed (matched
   * by idempotency key) before this link was recorded. See
   * `DashboardInvoicesApplicationService.createSaleFromInvoice`'s
   * idempotency-match self-heal branch.
   */
  async patchSourceInvoiceLink(
    documentId: string,
    sourceInvoiceId: string,
  ): Promise<void> {
    const document = await this.documentRepo.findById(documentId);
    if (!document) return;
    await this.documentRepo.save({ ...document, sourceInvoiceId });
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
      this.syncStateRepo,
    );
  }

  /**
   * Bulk/single retry for sales stuck in a Pending/Failed status -- backs the
   * dashboard's "Retry Sync" row action and multi-select bulk-action bar.
   * See `retry-sales.usecase.ts` for the exact retryable-status set and the
   * REJECTED/FAILED -> RETRYING hand-off.
   */
  async retrySales(input: RetrySalesInput): Promise<RetrySalesResult> {
    return retrySalesToEtims(input, {
      documentRepo: this.documentRepo,
      connectionRepo: this.connectionRepo,
      eventRepo: this.eventRepo,
      etimsAdapter: this.etimsAdapter,
      syncStateRepo: this.syncStateRepo,
    });
  }

  /**
   * Shared "submit a freshly-created document" pipeline: applies inventory
   * movements, then validate → prepare → submit. This is exactly the
   * sequence that `ApiSalesController.createSale` /
   * `DashboardSalesController.createSale` /
   * `DashboardInvoicesApplicationService.createSaleFromInvoice` need right
   * after creating a document with `submit=true`, extracted here so those
   * three call sites don't duplicate it. All three only call this
   * immediately after `createDocument` returns `created: true`, when the
   * document's status is always DRAFT, so there's no separate precondition
   * check here.
   */
  async submitDraftDocument(documentId: string): Promise<ComplianceDocument> {
    await this.applyInventoryMovements(documentId);

    const validation = await this.validateDocument(documentId);
    if (!validation.validation.isValid) {
      throw new BadRequestException({
        message: 'Sale validation failed',
        errors: validation.validation.errors,
      });
    }

    await this.prepareDocument(documentId);
    await this.submitDocument(documentId);

    return (await this.getDocument(documentId)).document;
  }

  /**
   * Internal stock accounting.
   *
   * - Only applies to stockable items (GOODS).
   * - SALE decreases stock, CREDIT_NOTE increases stock.
   *
   * This is intentionally independent of KRA acceptance: it tracks business
   * activity, not regulator submission success.
   */
  async applyInventoryMovements(documentId: string): Promise<void> {
    const { document } = await this.getDocument(documentId);

    const movementType =
      document.documentType === DocumentType.CREDIT_NOTE
        ? MovementType.RETURN
        : MovementType.SALE;

    const itemIds = [...new Set(document.lines.map((l) => l.itemId))];
    const items: ComplianceItem[] = await this.itemRepo.findByIds(itemIds);
    const itemsById = new Map(items.map((i) => [i.id, i]));

    for (const line of document.lines) {
      const item = itemsById.get(line.itemId);
      const isStockable = item
        ? deriveItemType(item.productTypeCode) === ItemType.GOODS
        : false;
      if (!isStockable) continue;

      await this.inventoryService.recordMovement({
        itemId: line.itemId,
        branchId: document.branchId,
        movementType,
        quantity: line.quantity,
        referenceType: 'COMPLIANCE_DOCUMENT',
        referenceId: document.id,
        unitPrice: line.unitPrice,
      });
    }
  }

  /**
   * Returns the persisted KRA (OSCU) response for `/saveTrnsSalesOsdc`,
   * sourced from the latest ACCEPTED event `responseSnapshot`.
   */
  async getKraSalesSaveResponse(
    documentId: string,
  ): Promise<Record<string, unknown> | null> {
    const events: ComplianceEvent[] =
      await this.eventRepo.findByDocumentId(documentId);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.eventType === 'ACCEPTED') {
        return e.responseSnapshot ?? null;
      }
    }
    return null;
  }

  async getNormalizedSaleReport(
    documentId: string,
  ): Promise<import('../controller/dto/sales-report.dto').SaleReportDto> {
    const { document } = await this.getDocument(documentId);
    const kraRaw = await this.getKraSalesSaveResponse(documentId);

    const itemIds = [...new Set(document.lines.map((l) => l.itemId))];
    const items: ComplianceItem[] = await this.itemRepo.findByIds(itemIds);
    const itemsById = new Map(items.map((i) => [i.id, i]));

    const connection = await this.connectionRepo.findByMerchantAndBranch(
      document.merchantId,
      document.branchId,
    );
    const tenant = await this.organizationService.getTenantBySync2booksCompanyId(
      document.merchantId,
    );

    const saleDate = document.saleDate ?? null;
    const date = saleDate ? formatDdMmYyyy(saleDate) : null;
    const time = formatTimeAmPm(document.createdAt);

    const kraData = (kraRaw?.data as Record<string, unknown> | null) ?? null;
    const curRcptNoRaw =
      kraData?.curRcptNo ??
      (kraData as Record<string, unknown>)?.['curRcptNo '];
    const receiptNumber = safeNumber(curRcptNoRaw);

    const rcptSign = safeString(kraData?.rcptSign);
    const intrlData = safeString(kraData?.intrlData);

    const etimsUrl =
      connection?.kraPin && rcptSign
        ? `https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceptData?{${connection.kraPin}+${document.branchId}+${rcptSign}}`
        : null;

    const taxBuckets = computeTaxBuckets(document);

    return {
      id: document.id,
      date,
      time,
      traderInvoiceNumber: document.documentNumber,
      receiptTypeCode: document.receiptTypeCode,
      saleDetailUrl: `/api/sales/${document.id}`,
      serialNumber: connection?.deviceId ?? null,
      receiptNumber,
      invoiceNumber: safeNumber(document.documentNumber),
      customerId: document.customerId,
      customerName: document.customerName,
      customerTin: document.customerPin,
      customerPhoneNumber: document.customerPhoneNumber,
      customerEmail: document.customerEmail,
      internalData: intrlData || null,
      receiptSignature: rcptSign || null,
      etimsUrl,
      originalSaleId: document.originalSaleId,
      offlineUrl: null,
      status: mapComplianceStatusToDigitax(document.complianceStatus),
      supplierName: tenant?.displayName ?? null,
      supplierPin: connection?.kraPin ?? null,
      sourceSystem: document.sourceSystem,
      paymentTypeCode: document.paymentTypeCode,
      paymentTypeDescription: paymentTypeDescription(document.paymentTypeCode),
      salesTaxSummary: {
        taxableAmountA: taxBuckets.taxableAmountA,
        taxableAmountB: taxBuckets.taxableAmountB,
        taxableAmountC: taxBuckets.taxableAmountC,
        taxableAmountD: taxBuckets.taxableAmountD,
        taxableAmountE: taxBuckets.taxableAmountE,
        taxRateA: taxBuckets.taxRateA,
        taxRateB: taxBuckets.taxRateB,
        taxRateC: taxBuckets.taxRateC,
        taxRateD: taxBuckets.taxRateD,
        taxRateE: taxBuckets.taxRateE,
        taxAmountA: taxBuckets.taxAmountA,
        taxAmountB: taxBuckets.taxAmountB,
        taxAmountC: taxBuckets.taxAmountC,
        taxAmountD: taxBuckets.taxAmountD,
        taxAmountE: taxBuckets.taxAmountE,
        cateringLevyRate: 0,
        serviceChargeRate: 0,
        cateringLevyAmount: 0,
        serviceChargeAmount: 0,
      },
      itemList: document.lines.map((l) => {
        const splyAmt = round2(l.quantity * l.unitPrice);
        const taxAmt = round2(l.taxAmount);
        const totAmt = round2(splyAmt + taxAmt);
        const taxTyCd = resolveTaxTypeCode(l.taxTyCdSnapshot, l.taxCategory);
        const taxRate = taxRateByTaxTypeCode(taxTyCd);
        const item = itemsById.get(l.itemId);

        return {
          id: l.id,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          totalAmount: totAmt,
          taxableAmount: splyAmt,
          taxAmount: taxAmt,
          taxRate,
          taxTypeCode: taxTyCd,
          discountRate: 0,
          discountAmount: 0,
          etimsItemCode: null,
          isStockable: item
            ? deriveItemType(item.productTypeCode) === ItemType.GOODS
            : null,
          itemId: l.itemId,
          itemName: item?.name ?? null,
          itemDescription: l.description || null,
        };
      }),
    };
  }

  /**
   * Renders the KRA eTIMS receipt as a PDF, on the fly, from the persisted
   * OSCU response. Returns null if the document hasn't reached ACCEPTED yet
   * (nothing to show — this is the source of truth for "has been synced").
   */
  async getEtimsReceiptPdf(documentId: string): Promise<Buffer | null> {
    const { document } = await this.getDocument(documentId);
    if (document.complianceStatus !== ComplianceStatus.ACCEPTED) {
      return null;
    }

    const kraRaw = await this.getKraSalesSaveResponse(documentId);
    const kraData = (kraRaw?.data as Record<string, unknown> | null) ?? null;
    const curRcptNoRaw =
      kraData?.curRcptNo ??
      (kraData as Record<string, unknown>)?.['curRcptNo '];
    const receiptNumber = safeNumber(curRcptNoRaw);
    const rcptSign = safeString(kraData?.rcptSign);
    const intrlData = safeString(kraData?.intrlData);

    const connection = await this.connectionRepo.findByMerchantAndBranch(
      document.merchantId,
      document.branchId,
    );
    const tenant = await this.organizationService.getTenantBySync2booksCompanyId(
      document.merchantId,
    );

    const etimsUrl =
      connection?.kraPin && rcptSign
        ? `https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceptData?{${connection.kraPin}+${document.branchId}+${rcptSign}}`
        : null;

    const itemIds = [...new Set(document.lines.map((l) => l.itemId))];
    const items: ComplianceItem[] = await this.itemRepo.findByIds(itemIds);
    const itemsById = new Map(items.map((i) => [i.id, i]));

    const taxBuckets = computeTaxBuckets(document);

    return generateEtimsReceiptPdf({
      document,
      connection,
      itemsById,
      receiptNumber,
      receiptSignature: rcptSign,
      internalData: intrlData,
      etimsUrl,
      supplierName: tenant?.displayName ?? null,
      paymentTypeDescription: paymentTypeDescription(document.paymentTypeCode),
      taxBuckets,
    });
  }

  async listNormalizedSaleReports(params: {
    merchantId: string;
    before?: string;
    after?: string;
    startDate?: string;
    endDate?: string;
    pageSize?: number;
  }): Promise<
    import('../controller/dto/sales-report.dto').SalesReportListResponseDto
  > {
    if (params.before && params.after) {
      throw new Error('Use either before or after, not both');
    }

    const pageSize = clampReportPageSize(params.pageSize ?? 20);
    const take = pageSize + 1;

    // Optimized path (TypeORM repo) - keyset pagination + batched line fetch
    const docRepo = this.documentRepo as unknown as {
      findPageByMerchantWithLines?: (args: {
        merchantId: string;
        beforeId?: string;
        afterId?: string;
        startDate?: string;
        endDate?: string;
        take: number;
      }) => Promise<ComplianceDocument[]>;
    };

    const docs: ComplianceDocument[] = docRepo.findPageByMerchantWithLines
      ? await docRepo.findPageByMerchantWithLines({
          merchantId: params.merchantId,
          beforeId: params.before,
          afterId: params.after,
          startDate: params.startDate,
          endDate: params.endDate,
          take,
        })
      : await this.documentRepo.findByMerchant(params.merchantId);

    const hasMore = docs.length > pageSize;
    const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;
    const next =
      hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1].id : null;
    const previous = pageDocs.length > 0 ? pageDocs[0].id : null;

    // Batch fetch: latest ACCEPTED response per document
    const eventRepo = this.eventRepo as unknown as {
      findLatestAcceptedByDocumentIds?: (
        ids: string[],
      ) => Promise<Map<string, Record<string, unknown> | null>>;
    };
    const docIds = pageDocs.map((d) => d.id);
    const kraByDocId = eventRepo.findLatestAcceptedByDocumentIds
      ? await eventRepo.findLatestAcceptedByDocumentIds(docIds)
      : new Map<string, Record<string, unknown> | null>();

    // Batch fetch: all items referenced by this page
    const itemIds = [
      ...new Set(pageDocs.flatMap((d) => d.lines.map((l) => l.itemId))),
    ];
    const items: ComplianceItem[] =
      itemIds.length > 0 ? await this.itemRepo.findByIds(itemIds) : [];
    const itemsById = new Map(items.map((i) => [i.id, i]));

    // Cache connections within page (merchantId/branchId pairs)
    const connByKey = new Map<string, ComplianceConnection | null>();
    const getConn = async (
      merchantId: string,
      branchId: string,
    ): Promise<ComplianceConnection | null> => {
      const key = `${merchantId}:${branchId}`;
      if (connByKey.has(key)) return connByKey.get(key) ?? null;
      const c = await this.connectionRepo.findByMerchantAndBranch(
        merchantId,
        branchId,
      );
      connByKey.set(key, c);
      return c;
    };

    // Cache tenant display names within page (merchantId only)
    const supplierNameByMerchant = new Map<string, string | null>();
    const getSupplierName = async (merchantId: string): Promise<string | null> => {
      if (supplierNameByMerchant.has(merchantId)) {
        return supplierNameByMerchant.get(merchantId) ?? null;
      }
      const tenant =
        await this.organizationService.getTenantBySync2booksCompanyId(
          merchantId,
        );
      const name = tenant?.displayName ?? null;
      supplierNameByMerchant.set(merchantId, name);
      return name;
    };

    const data = await Promise.all(
      pageDocs.map(async (d) => {
        const kra = kraByDocId.get(d.id) ?? null;
        const conn = await getConn(d.merchantId, d.branchId);
        const supplierName = await getSupplierName(d.merchantId);
        return buildNormalizedSaleReport({
          document: d,
          kraRaw: kra,
          connection: conn,
          itemsById,
          supplierName,
        });
      }),
    );

    return {
      pagination: {
        next,
        previous,
        pageSize,
      },
      data,
    };
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
function clampReportPageSize(n: number): number {
  // Digitax UI shows 1..20; keep the same default/max for report endpoints.
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatDdMmYyyy(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-');
  if (!y || !m || !d) return yyyyMmDd;
  return `${d}/${m}/${y}`;
}

function formatTimeAmPm(date: Date): string {
  const hours = date.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const ampm = hours >= 12 ? 'pm' : 'am';
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${pad2(h12)}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${ampm}`;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function mapComplianceStatusToDigitax(status: ComplianceStatus): string {
  switch (status) {
    case ComplianceStatus.ACCEPTED:
      return 'completed';
    case ComplianceStatus.REJECTED:
    case ComplianceStatus.FAILED:
      return 'failed';
    case ComplianceStatus.RETRYING:
      return 'retrying';
    case ComplianceStatus.CANCELLED:
      return 'cancelled';
    default:
      return 'pending';
  }
}

function taxRateByTaxTypeCode(code: string | null): number {
  return oscuTaxRateForCode(code);
}

/** OSCU pmtTyCd (code classification 07 per spec) -> human-readable label, matching oscu-mapping.seed.ts's internalPaymentMethod bucketing. */
const PAYMENT_TYPE_LABELS: Record<string, string> = {
  '01': 'Cash',
  '02': 'Credit',
  '03': 'Cash/Credit',
  '04': 'Bank Check',
  '05': 'Debit and Credit Card',
  '06': 'Card',
  '07': 'Mobile Money',
  '08': 'Other',
};

function paymentTypeDescription(pmtTyCd: string | null): string | null {
  if (!pmtTyCd) return null;
  return PAYMENT_TYPE_LABELS[pmtTyCd] ?? null;
}

function resolveTaxTypeCode(
  snapshot: string | null,
  taxCategory: TaxCategory,
): string | null {
  if (snapshot && snapshot.trim() !== '') return snapshot;
  // Matches the canonical convention used elsewhere (MappingSuggestionService's
  // TAX_CATEGORY_CODE, oscu_codes cdCls='04', DashboardMappingApplicationService):
  // EXEMPT=A, VAT_STANDARD=B, VAT_ZERO=C.
  switch (taxCategory) {
    case TaxCategory.VAT_STANDARD:
      return 'B';
    case TaxCategory.VAT_ZERO:
      return 'C';
    case TaxCategory.EXEMPT:
      return 'A';
    default:
      return null;
  }
}

function computeTaxBuckets(document: ComplianceDocument): {
  taxableAmountA: number;
  taxableAmountB: number;
  taxableAmountC: number;
  taxableAmountD: number;
  taxableAmountE: number;
  taxAmountA: number;
  taxAmountB: number;
  taxAmountC: number;
  taxAmountD: number;
  taxAmountE: number;
  taxRateA: number;
  taxRateB: number;
  taxRateC: number;
  taxRateD: number;
  taxRateE: number;
} {
  const buckets = {
    taxableAmountA: 0,
    taxableAmountB: 0,
    taxableAmountC: 0,
    taxableAmountD: 0,
    taxableAmountE: 0,
    taxAmountA: 0,
    taxAmountB: 0,
    taxAmountC: 0,
    taxAmountD: 0,
    taxAmountE: 0,
  };

  for (const l of document.lines) {
    const code = resolveTaxTypeCode(l.taxTyCdSnapshot, l.taxCategory);
    const taxable = round2(l.quantity * l.unitPrice);
    const taxAmt = round2(l.taxAmount);
    switch (code) {
      case 'A':
        buckets.taxableAmountA += taxable;
        buckets.taxAmountA += taxAmt;
        break;
      case 'B':
        buckets.taxableAmountB += taxable;
        buckets.taxAmountB += taxAmt;
        break;
      case 'C':
        buckets.taxableAmountC += taxable;
        buckets.taxAmountC += taxAmt;
        break;
      case 'D':
        buckets.taxableAmountD += taxable;
        buckets.taxAmountD += taxAmt;
        break;
      case 'E':
        buckets.taxableAmountE += taxable;
        buckets.taxAmountE += taxAmt;
        break;
    }
  }

  return {
    taxableAmountA: round2(buckets.taxableAmountA),
    taxableAmountB: round2(buckets.taxableAmountB),
    taxableAmountC: round2(buckets.taxableAmountC),
    taxableAmountD: round2(buckets.taxableAmountD),
    taxableAmountE: round2(buckets.taxableAmountE),
    taxAmountA: round2(buckets.taxAmountA),
    taxAmountB: round2(buckets.taxAmountB),
    taxAmountC: round2(buckets.taxAmountC),
    taxAmountD: round2(buckets.taxAmountD),
    taxAmountE: round2(buckets.taxAmountE),
    taxRateA: OSCU_TAX_RATE_BY_TAX_TY_CD.A,
    taxRateB: OSCU_TAX_RATE_BY_TAX_TY_CD.B,
    taxRateC: OSCU_TAX_RATE_BY_TAX_TY_CD.C,
    taxRateD: OSCU_TAX_RATE_BY_TAX_TY_CD.D,
    taxRateE: OSCU_TAX_RATE_BY_TAX_TY_CD.E,
  };
}

function buildNormalizedSaleReport(input: {
  document: ComplianceDocument;
  kraRaw: Record<string, unknown> | null;
  connection: ComplianceConnection | null;
  itemsById: Map<string, ComplianceItem>;
  supplierName: string | null;
}): import('../controller/dto/sales-report.dto').SaleReportDto {
  const { document, kraRaw, connection, itemsById, supplierName } = input;
  const kraData = (kraRaw?.data as Record<string, unknown> | null) ?? null;
  const curRcptNoRaw =
    kraData?.curRcptNo ?? (kraData as Record<string, unknown>)?.['curRcptNo '];
  const receiptNumber = safeNumber(curRcptNoRaw);

  const saleDate = document.saleDate ?? null;
  const date = saleDate ? formatDdMmYyyy(saleDate) : null;
  const time = formatTimeAmPm(document.createdAt);

  const rcptSign = safeString(kraData?.rcptSign);
  const intrlData = safeString(kraData?.intrlData);

  const etimsUrl =
    connection?.kraPin && rcptSign
      ? `https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceptData?{${connection.kraPin}+${document.branchId}+${rcptSign}}`
      : null;

  const taxBuckets = computeTaxBuckets(document);

  return {
    id: document.id,
    date,
    time,
    traderInvoiceNumber: document.documentNumber,
    receiptTypeCode: document.receiptTypeCode,
    saleDetailUrl: `/api/sales/${document.id}`,
    serialNumber: connection?.deviceId ?? null,
    receiptNumber,
    invoiceNumber: safeNumber(document.documentNumber),
    customerId: document.customerId,
    customerName: document.customerName,
    customerTin: document.customerPin,
    customerPhoneNumber: document.customerPhoneNumber,
    customerEmail: document.customerEmail,
    internalData: intrlData || null,
    receiptSignature: rcptSign || null,
    etimsUrl,
    originalSaleId: document.originalSaleId,
    offlineUrl: null,
    status: mapComplianceStatusToDigitax(document.complianceStatus),
    supplierName,
    supplierPin: connection?.kraPin ?? null,
    sourceSystem: document.sourceSystem,
    paymentTypeCode: document.paymentTypeCode,
    paymentTypeDescription: paymentTypeDescription(document.paymentTypeCode),
    salesTaxSummary: {
      taxableAmountA: taxBuckets.taxableAmountA,
      taxableAmountB: taxBuckets.taxableAmountB,
      taxableAmountC: taxBuckets.taxableAmountC,
      taxableAmountD: taxBuckets.taxableAmountD,
      taxableAmountE: taxBuckets.taxableAmountE,
      taxRateA: taxBuckets.taxRateA,
      taxRateB: taxBuckets.taxRateB,
      taxRateC: taxBuckets.taxRateC,
      taxRateD: taxBuckets.taxRateD,
      taxRateE: taxBuckets.taxRateE,
      cateringLevyRate: 0,
      serviceChargeRate: 0,
      taxAmountA: taxBuckets.taxAmountA,
      taxAmountB: taxBuckets.taxAmountB,
      taxAmountC: taxBuckets.taxAmountC,
      taxAmountD: taxBuckets.taxAmountD,
      taxAmountE: taxBuckets.taxAmountE,
      cateringLevyAmount: 0,
      serviceChargeAmount: 0,
    },
    itemList: document.lines.map((l) => {
      const splyAmt = round2(l.quantity * l.unitPrice);
      const taxAmt = round2(l.taxAmount);
      const totAmt = round2(splyAmt + taxAmt);
      const taxTyCd = resolveTaxTypeCode(l.taxTyCdSnapshot, l.taxCategory);
      const taxRate = taxRateByTaxTypeCode(taxTyCd);
      const item = itemsById.get(l.itemId);

      return {
        id: l.id,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        totalAmount: totAmt,
        taxableAmount: splyAmt,
        taxAmount: taxAmt,
        taxRate,
        taxTypeCode: taxTyCd,
        discountRate: 0,
        discountAmount: 0,
        etimsItemCode: null,
        isStockable: item
          ? deriveItemType(item.productTypeCode) === ItemType.GOODS
          : null,
        itemId: l.itemId,
        itemName: item?.name ?? null,
        itemDescription: l.description || null,
      };
    }),
  };
}
