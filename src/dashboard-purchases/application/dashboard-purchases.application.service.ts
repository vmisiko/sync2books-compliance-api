import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, type Repository } from 'typeorm';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { DashboardSuppliersApplicationService } from '../../dashboard-suppliers/application/dashboard-suppliers.application.service';
import { OscuOperationsService } from '../../regulatory/oscu/presentation/oscu-operations.service';
import {
  MainApiConnectionApplicationService,
  SUPPORTED_INTEGRATION_KEYS,
  type SupportedIntegrationKey,
} from '../../integration/main-api-pull/application/main-api-connection.application.service';
import {
  MainApiPullClient,
  type MainApiCreateBillLineItem,
} from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { OscuSyncStateOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';
import { taxCategoryForCode } from '../../regulatory/oscu/mapping/oscu-tax-rates';
import { CatalogService } from '../../catalog/api/catalog.service';
import { CATALOG_ITEM_REPO } from '../../shared/tokens';
import type { ICatalogItemRepository } from '../../catalog/domain/ports/item-repository.port';
import type { CatalogItem } from '../../catalog/domain/entities/catalog-item.entity';
import {
  PurchaseInvoiceOrmEntity,
  type PurchaseLineItemJson,
} from '../infrastructure/persistence/purchase-invoice.orm-entity';
import {
  buildPurchaseConfirmationPayload,
  extractRawItemList,
  rawItemName,
  resolveTaxLetter,
  toNumber as toRawNumber,
  toStr as toRawStr,
  type MatchedPurchaseItem,
  type RawKraPurchaseItem,
} from './purchase-kra-confirmation.builder';

const PRODUCT_TYPE_CODES = ['1', '2', '3'] as const;

/** KRA's own sample `lastReqDt` for a first-ever pull (OSCU spec §3.3.3.1 JSON SAMPLE). */
const EPOCH_LAST_REQ_DT = '20180523000000';

export type ConfirmError = {
  id: string;
  receiptNo: string;
  message: string;
};

export type PurchaseInvoiceDto = {
  id: string;
  receiptNo: string;
  supplierName: string;
  supplierPin: string;
  branch: string;
  invoiceDate: string;
  subtotal: number;
  vat: number;
  total: number;
  confirmationStatus: PurchaseInvoiceOrmEntity['confirmationStatus'];
  erpSyncStatus: PurchaseInvoiceOrmEntity['erpSyncStatus'];
  /** Error message from the last failed `syncToErp` attempt, if any. */
  erpSyncError: string | null;
  /** dashboard_suppliers.id, once matched (auto on pull, or via link-supplier/create-supplier). Null means unmatched. */
  supplierId: string | null;
  lineItems: PurchaseLineItemJson[];
  /** Error/rejection message from the last `sendPurchaseTransactionInfo` attempt, if any. */
  kraConfirmError: string | null;
  etimsMetadata: {
    fetchedAt: string;
    /** Supplier's own KRA-assigned Sales Data Controller id (`spplrSdcId`) -- there is no separate "KRA invoice number" for a pulled purchase; the only invoice number in this data is the supplier's own `spplrInvcNo` (see `receiptNo`). */
    controlUnit: string;
    /** Supplier's own KRA-assigned Machine/Registration Certificate number (`spplrMrcNo`). */
    supplierMrcNo: string;
    receiptType: string;
    /** Not a real cryptographic signature -- KRA doesn't return one for a pulled purchase record. Just our own dedup/correlation key (`spplrTin-spplrInvcNo`). */
    reference: string;
  };
};

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toStr(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

/** Accepts KRA's `yyyyMMdd` or `yyyyMMddhhmmss` and returns an ISO date string. Falls back to today. */
function parseKraDate(value: unknown): string {
  const s = toStr(value);
  if (!s || !/^\d{8,14}$/.test(s)) return new Date().toISOString().slice(0, 10);
  const year = s.slice(0, 4);
  const month = s.slice(4, 6);
  const day = s.slice(6, 8);
  return `${year}-${month}-${day}`;
}

@Injectable()
export class DashboardPurchasesApplicationService {
  private readonly logger = new Logger(
    DashboardPurchasesApplicationService.name,
  );

  constructor(
    @InjectRepository(PurchaseInvoiceOrmEntity)
    private readonly repo: Repository<PurchaseInvoiceOrmEntity>,
    @InjectRepository(OscuSyncStateOrmEntity)
    private readonly syncStateRepo: Repository<OscuSyncStateOrmEntity>,
    @Inject(CATALOG_ITEM_REPO)
    private readonly catalogRepo: ICatalogItemRepository,
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly oscuOperations: OscuOperationsService,
    private readonly suppliers: DashboardSuppliersApplicationService,
    private readonly catalog: CatalogService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
  ) {}

  async pull(
    complianceTenantId: string,
    options: { branchId?: string; autoMarkPendingReview?: boolean } = {},
  ): Promise<{ data: PurchaseInvoiceDto[]; total: number }> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const branches = (
      await this.organization.listBranches(complianceTenantId)
    ).filter(
      (b) =>
        !!b.sync2booksBranchId &&
        (!options.branchId || b.id === options.branchId),
    );

    for (const branch of branches) {
      try {
        const envelope = await this.oscuOperations.purchaseTransactionInfo(
          merchantId,
          branch.sync2booksBranchId as string,
          EPOCH_LAST_REQ_DT,
        );
        const data = (envelope as { rawResponse?: Record<string, unknown> })
          .rawResponse?.data;
        const records = Array.isArray(
          (data as { saleList?: unknown })?.saleList,
        )
          ? ((data as { saleList: unknown[] }).saleList as Record<
              string,
              unknown
            >[])
          : [];

        for (const record of records) {
          await this.upsertFromKraRecord(
            merchantId,
            branch,
            record,
            options.autoMarkPendingReview ?? true,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Purchase pull failed for merchant=${merchantId} branch=${branch.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return this.list(complianceTenantId);
  }

  async list(
    complianceTenantId: string,
  ): Promise<{ data: PurchaseInvoiceDto[]; total: number }> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const rows = await this.repo.find({
      where: { merchantId },
      order: { invoiceDate: 'DESC', createdAt: 'DESC' },
    });
    const data = rows.map((r) => this.toDto(r));
    return { data, total: data.length };
  }

  async getById(
    complianceTenantId: string,
    id: string,
  ): Promise<PurchaseInvoiceDto> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const row = await this.repo.findOne({ where: { id, merchantId } });
    if (!row) throw new NotFoundException(`Purchase invoice ${id} not found`);
    return this.toDto(row);
  }

  /**
   * Confirms each selected invoice to KRA via `sendPurchaseTransactionInfo`
   * (a real 2-party OSCU write, not local bookkeeping -- see
   * oscu-payload-gotchas.md's "sendPurchaseTransactionInfo /
   * getPurchaseTransactionInfo" section). KRA requires every purchased item
   * to already exist in the buyer's own catalog under the buyer's own
   * `itemCd`, so each raw line is matched by exact name against this
   * merchant's registered catalog items first -- an invoice with any
   * unmatched line is left untouched (still pending_review) and reported in
   * `errors`, rather than partially/incorrectly submitted. Only local
   * confirmationStatus flips to 'confirmed' once KRA itself accepts.
   */
  async confirm(
    complianceTenantId: string,
    ids: string[],
  ): Promise<{
    data: PurchaseInvoiceDto[];
    total: number;
    errors: ConfirmError[];
  }> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const rows = await this.repo.find({ where: { merchantId, id: In(ids) } });
    const branches = await this.organization.listBranches(complianceTenantId);
    const errors: ConfirmError[] = [];

    /** Records a failure both in the response and on the row, so it survives a reload (e.g. the detail sheet's error banner). */
    const fail = async (
      row: PurchaseInvoiceOrmEntity,
      message: string,
    ): Promise<void> => {
      errors.push(this.confirmError(row, message));
      row.kraConfirmError = message;
      await this.repo.save(row);
    };

    for (const row of rows) {
      if (row.confirmationStatus === 'confirmed') continue;

      if (!row.supplierPin) {
        await fail(
          row,
          'Missing supplier PIN — cannot claim Input VAT for this invoice.',
        );
        continue;
      }

      const branch = branches.find((b) => b.id === row.branchId);
      if (!branch?.sync2booksBranchId) {
        await fail(row, 'Branch has no active eTIMS connection.');
        continue;
      }

      const connectionInfo =
        await this.organization.getEtimsConnectionForBranch(branch.id);
      if (!connectionInfo) {
        await fail(row, 'No active eTIMS connection for this branch.');
        continue;
      }

      const rawItems = extractRawItemList(row.rawKraResponse);
      if (!rawItems.length) {
        await fail(row, 'No line items recorded from eTIMS for this invoice.');
        continue;
      }

      const matches: MatchedPurchaseItem[] = [];
      const missing: string[] = [];
      for (const raw of rawItems) {
        const name = rawItemName(raw);
        const catalogItem = name
          ? await this.catalogRepo.findByMerchantAndName(merchantId, name)
          : null;
        if (
          !catalogItem ||
          catalogItem.registrationStatus !== 'REGISTERED' ||
          !catalogItem.etimsItemCode
        ) {
          missing.push(name || 'unnamed item');
          continue;
        }
        matches.push({ raw, catalogItem });
      }

      if (missing.length) {
        await fail(
          row,
          `Register these items in your catalog (Item Sync) before confirming to KRA: ${missing.join(', ')}`,
        );
        continue;
      }

      let invcNo = row.kraConfirmInvcNo;
      if (invcNo == null) {
        invcNo = await this.allocatePurchaseInvcNo(
          connectionInfo.kraPin,
          connectionInfo.environment,
        );
        row.kraConfirmInvcNo = invcNo;
        await this.repo.save(row);
      }

      const payload = buildPurchaseConfirmationPayload({
        row,
        matches,
        invcNo,
        now: new Date(),
      });

      let envelope: { success: boolean; error?: string };
      try {
        envelope = await this.oscuOperations.sendPurchaseTransaction(
          merchantId,
          branch.sync2booksBranchId,
          payload,
        );
      } catch (error) {
        envelope = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (envelope.success) {
        row.confirmationStatus = 'confirmed';
        row.kraConfirmResultCd = '000';
        row.kraConfirmError = null;
        row.kraConfirmedAt = new Date();
        await this.repo.save(row);
      } else {
        const message = envelope.error ?? 'KRA rejected the confirmation.';
        const isRetryable = message.includes('retryable');
        if (!isRetryable) {
          await this.releasePurchaseInvcNo(
            connectionInfo.kraPin,
            connectionInfo.environment,
            invcNo,
          );
          row.kraConfirmInvcNo = null;
        }
        row.kraConfirmError = message;
        await this.repo.save(row);
        errors.push(this.confirmError(row, message));
      }
    }

    const result = await this.list(complianceTenantId);
    return { ...result, errors };
  }

  async reject(
    complianceTenantId: string,
    ids: string[],
  ): Promise<{ data: PurchaseInvoiceDto[]; total: number }> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const rows = await this.repo.find({ where: { merchantId } });
    const toUpdate = rows.filter((r) => ids.includes(r.id));
    for (const row of toUpdate) row.confirmationStatus = 'rejected';
    await this.repo.save(toUpdate);
    return this.list(complianceTenantId);
  }

  /** Manually links a purchase invoice to an existing Supplier — e.g. correcting a TIN mismatch the auto-match on pull couldn't resolve. */
  async linkSupplier(
    complianceTenantId: string,
    id: string,
    supplierId: string,
  ): Promise<PurchaseInvoiceDto> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const row = await this.repo.findOne({ where: { id, merchantId } });
    if (!row) throw new NotFoundException(`Purchase invoice ${id} not found`);

    // Throws NotFoundException itself if this supplier doesn't belong to this merchant.
    await this.suppliers.getById(merchantId, supplierId);

    row.supplierId = supplierId;
    await this.repo.save(row);
    return this.toDto(row);
  }

  /**
   * Resolves an "Unmatched" purchase by creating a new Supplier from its own
   * KRA-sourced name/PIN (sourceSystem: 'ETIMS' — it didn't come from an
   * ERP, so it isn't tagged as one; it has no externalId/bookId, so it's a
   * reconciliation placeholder, not something that can push a Bill to an
   * ERP until someone connects/creates the real vendor there too). Re-checks
   * findByTin first so two people resolving the same unmatched supplier
   * around the same time -- or a supplier that arrived via a pull in the
   * meantime -- never produces a duplicate. Then backfills every other
   * still-unmatched purchase for this merchant with the same spplrTin, since
   * they're all the same real-world counterparty.
   */
  async createSupplierFromPurchase(
    complianceTenantId: string,
    id: string,
    overrides: { phoneNumber?: string; email?: string } = {},
  ): Promise<{
    purchase: PurchaseInvoiceDto;
    supplierId: string;
    backfilledCount: number;
  }> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const row = await this.repo.findOne({ where: { id, merchantId } });
    if (!row) throw new NotFoundException(`Purchase invoice ${id} not found`);
    if (!row.supplierPin) {
      throw new BadRequestException(
        'This purchase invoice has no supplier PIN — nothing to create a supplier from.',
      );
    }

    // overrides (phoneNumber/email) only apply to a genuinely new Supplier --
    // never silently overwrite an existing match's contact details just
    // because this dialog happened to collect different values.
    const supplier =
      (await this.suppliers.findByTin(merchantId, row.supplierPin)) ??
      (await this.suppliers.create({
        merchantId,
        name: row.supplierName,
        tin: row.supplierPin,
        phoneNumber: overrides.phoneNumber,
        email: overrides.email,
        sourceSystem: 'ETIMS',
      }));

    row.supplierId = supplier.id;
    await this.repo.save(row);

    const others = await this.repo.find({
      where: { merchantId, spplrTin: row.supplierPin, supplierId: IsNull() },
    });
    for (const other of others) other.supplierId = supplier.id;
    if (others.length) await this.repo.save(others);

    return {
      purchase: this.toDto(row),
      supplierId: supplier.id,
      backfilledCount: others.length,
    };
  }

  /**
   * `sendPurchaseTransactionInfo` is a real, working OSCU write
   * (`OscuOperationsService.sendPurchaseTransaction`) — but it confirms the
   * purchase to *KRA*, a genuinely separate 2-party flow requiring the
   * purchased item to already exist in our own catalog under our own
   * `itemCd` (see oscu-payload-gotchas.md). This is a third, unrelated
   * thing this button asks for: pushing the confirmed purchase into the
   * tenant's connected accounting system (QuickBooks/Odoo) as a vendor
   * Bill.
   *
   * Always posts a Bill (Accounts Payable), never a one-step "paid"
   * object — see `.docs/PURCHASE_TO_ERP_SYNC_PLAN.md`'s decision: KRA's
   * `pmtTyCd` on the purchase is captured (see `paymentTypeCode`) but not
   * yet acted on, so there's no signal here that the purchase was actually
   * paid in cash. The ERP write itself is async (main API's queue-first
   * pattern) — a `synced` `erpSyncStatus` here means the Bill was queued
   * successfully, not that QuickBooks/Odoo has confirmed it yet.
   */
  async syncToErp(
    complianceTenantId: string,
    ids: string[],
  ): Promise<{
    data: PurchaseInvoiceDto[];
    total: number;
    errors: ConfirmError[];
  }> {
    if (!ids?.length) {
      throw new BadRequestException('No purchase invoices selected');
    }

    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const rows = await this.repo.find({ where: { merchantId, id: In(ids) } });
    const errors: ConfirmError[] = [];

    const fail = async (row: PurchaseInvoiceOrmEntity, message: string) => {
      errors.push(this.confirmError(row, message));
      row.erpSyncStatus = 'sync_failed';
      row.erpSyncError = message;
      await this.repo.save(row);
    };

    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);
    const connectedKey = SUPPORTED_INTEGRATION_KEYS.find(
      (key: SupportedIntegrationKey) =>
        connection.integrations[key]?.connectionId,
    );
    const connectionId = connectedKey
      ? connection.integrations[connectedKey]?.connectionId
      : null;

    if (!connectionId) {
      for (const row of rows) {
        await fail(
          row,
          'No connected accounting system for this tenant yet — connect QuickBooks or Odoo before syncing purchases.',
        );
      }
      const result = await this.list(complianceTenantId);
      return { ...result, errors };
    }

    for (const row of rows) {
      if (row.erpSyncStatus === 'synced') continue;

      if (row.confirmationStatus !== 'confirmed') {
        await fail(
          row,
          'Purchase must be confirmed with KRA before it can be synced to your accounting system.',
        );
        continue;
      }

      if (!row.supplierId) {
        await fail(
          row,
          'Link this purchase to a supplier before syncing to your accounting system.',
        );
        continue;
      }

      let supplierBookId: string | null;
      try {
        const supplier = await this.suppliers.getById(
          merchantId,
          row.supplierId,
        );
        supplierBookId = supplier.bookId;
      } catch (error) {
        await fail(
          row,
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }

      if (!supplierBookId) {
        await fail(
          row,
          `Supplier "${row.supplierName}" is not linked to a record in your accounting system yet — re-pull suppliers (Mapping Center) or link it manually.`,
        );
        continue;
      }

      const lineItems: MainApiCreateBillLineItem[] = row.lineItems.map(
        (item) => ({
          description: item.description,
          unitAmount: item.unitPrice,
          quantity: item.qty,
          subTotal: item.total - item.taxAmount,
          taxAmount: item.taxAmount,
          totalAmount: item.total,
          isDirectCost: true,
        }),
      );

      try {
        // awaitSync defaults to true here: main API blocks until the ERP write actually
        // completes, so `billResult.bill.syncStatus` below reflects the real outcome, not just
        // "queued" — see MainApiPullClient.createBill's doc comment.
        const billResult = await this.mainApiPull.createBill(
          connection.mainApiApiKey,
          connectionId,
          {
            reference: row.receiptNo,
            supplierRef: { id: supplierBookId, supplierName: row.supplierName },
            issueDate: new Date(row.invoiceDate).toISOString(),
            // Every amount pulled from KRA is implicitly KES already — see
            // [[project-etims-currency-gap]], same assumption inherited here.
            currency: 'KES',
            subTotal: row.subtotal,
            taxAmount: row.vat,
            totalAmount: row.total,
            lineItems,
            note: `Synced from KRA eTIMS purchase confirmation (${row.receiptNo})`,
            status: 'Open',
          },
        );

        row.erpBillId = billResult.bill.id;
        row.erpSyncBatchId = billResult.syncBatchId;

        if (billResult.bill.syncStatus === 'synced') {
          row.erpSyncStatus = 'synced';
          row.erpSyncError = null;
          row.erpSyncedAt = new Date();
          await this.repo.save(row);
        } else {
          await fail(
            row,
            billResult.bill.syncError ??
              `Bill was created in main API but the write to your accounting system did not complete (status: ${billResult.bill.syncStatus ?? 'unknown'}).`,
          );
        }
      } catch (error) {
        await fail(
          row,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const result = await this.list(complianceTenantId);
    return { ...result, errors };
  }

  /**
   * Registers a single purchase line item as a catalog item, sourced
   * straight from the raw KRA record already stored on this invoice --
   * classification/unit/tax codes come from what the supplier already
   * filed with KRA (a classification code describes the product itself,
   * not who's selling it, so reusing it is correct, not a guess -- see
   * resolveTaxLetter's doc comment for the equivalent tax reasoning). The
   * one thing genuinely not knowable from this data is productTypeCode
   * (Raw Material vs Finished Product vs Service) -- required here as an
   * explicit caller input, never inferred, same rule as everywhere else in
   * the catalog (see CatalogItem.productTypeCode's doc comment). Once
   * registered and synced to KRA (Item Sync), the next confirm() attempt on
   * this invoice will find this item by exact name match and stop
   * reporting it as missing.
   */
  async registerLineItemFromPurchase(
    complianceTenantId: string,
    purchaseInvoiceId: string,
    lineItemId: string,
    productTypeCode: string,
  ): Promise<{ item: CatalogItem; created: boolean }> {
    if (!(PRODUCT_TYPE_CODES as readonly string[]).includes(productTypeCode)) {
      throw new BadRequestException(
        "productTypeCode must be '1' (Raw Material), '2' (Finished Product) or '3' (Service)",
      );
    }

    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const row = await this.repo.findOne({
      where: { id: purchaseInvoiceId, merchantId },
    });
    if (!row) {
      throw new NotFoundException(
        `Purchase invoice ${purchaseInvoiceId} not found`,
      );
    }

    const raw = this.findRawLineItem(row, lineItemId);
    if (!raw) {
      throw new NotFoundException(
        `Line item ${lineItemId} not found on purchase invoice ${purchaseInvoiceId}`,
      );
    }

    const name = rawItemName(raw);
    if (!name) {
      throw new BadRequestException(
        'This line item has no item name to register.',
      );
    }

    // Scoped by spplrTin -- a raw itemCd is only unique per-supplier
    // (KRA's own itemCd sequence is per-tin), so two different suppliers'
    // items could otherwise collide on the same externalId.
    const supplierItemCd = toRawStr(raw.itemCd);
    const externalId =
      row.spplrTin && supplierItemCd
        ? `${row.spplrTin}:${supplierItemCd}`
        : null;

    const taxTyCd = resolveTaxLetter(raw);
    const unitPrice = toRawNumber(
      raw.prc,
      toRawNumber(raw.totAmt ?? raw.splyAmt, 0),
    );

    return this.catalog.registerItem({
      merchantId,
      externalId,
      name,
      taxCategory: taxCategoryForCode(taxTyCd),
      classificationCode: toRawStr(raw.itemClsCd ?? raw.hsCd) || undefined,
      unitCode: toRawStr(raw.qtyUnitCd) || undefined,
      packagingUnitCode: toRawStr(raw.pkgUnitCd) || undefined,
      taxTyCd,
      productTypeCode,
      unitPrice,
      originCountry: 'KE',
      sourceSystem: 'ETIMS',
    });
  }

  private findRawLineItem(
    row: PurchaseInvoiceOrmEntity,
    lineItemId: string,
  ): RawKraPurchaseItem | null {
    const rawItems = extractRawItemList(row.rawKraResponse);
    for (let i = 0; i < rawItems.length; i++) {
      const id = toRawStr(rawItems[i].itemSeq) || String(i + 1);
      if (id === lineItemId) return rawItems[i];
    }
    return null;
  }

  private async upsertFromKraRecord(
    merchantId: string,
    branch: { id: string; displayName: string | null; kraBhfId: string | null },
    record: Record<string, unknown>,
    autoMarkPendingReview: boolean,
  ): Promise<void> {
    const spplrTin = toStr(record.spplrTin) ?? null;
    const spplrInvcNo = toStr(record.spplrInvcNo ?? record.invcNo) ?? null;

    const itemList = Array.isArray(record.itemList)
      ? (record.itemList as Record<string, unknown>[])
      : [];
    const lineItems: PurchaseLineItemJson[] = itemList.map((item, idx) => {
      const total = toNumber(item.totAmt ?? item.splyAmt) ?? 0;
      const taxAmount = toNumber(item.taxAmt) ?? 0;
      const qty = toNumber(item.qty) ?? 1;
      const unitPrice =
        toNumber(item.prc) ?? (qty ? (total - taxAmount) / qty : total);
      return {
        id: toStr(item.itemSeq) ?? String(idx + 1),
        description: toStr(item.itemNm ?? item.spplrItemNm) ?? 'Item',
        hsCode: toStr(item.itemClsCd ?? item.hsCd) ?? '',
        qty,
        unitPrice,
        taxRate: toNumber(item.taxRt) ?? 16,
        taxAmount,
        total,
      };
    });

    const subtotal =
      toNumber(record.totTaxblAmt) ??
      lineItems.reduce((sum, l) => sum + (l.total - l.taxAmount), 0);
    const vat =
      toNumber(record.totTaxAmt) ??
      lineItems.reduce((sum, l) => sum + l.taxAmount, 0);
    const total = toNumber(record.totAmt) ?? subtotal + vat;

    const existing = spplrTin
      ? await this.repo.findOne({
          where: {
            merchantId,
            spplrTin,
            spplrInvcNo: spplrInvcNo ?? IsNull(),
          },
        })
      : null;

    // Auto-match by KRA PIN, but never override a supplierId that's already
    // set -- whether it was matched on an earlier pull or set manually via
    // link-supplier/create-supplier. A later pull only fills in a match for
    // a row that's still unmatched; it never re-decides one that already has
    // an answer.
    const matchedSupplier = spplrTin
      ? await this.suppliers.findByTin(merchantId, spplrTin)
      : null;
    const supplierId = existing?.supplierId ?? matchedSupplier?.id ?? null;

    const fields = {
      merchantId,
      branchId: branch.id,
      branchName: branch.displayName,
      kraBhfId: branch.kraBhfId,
      spplrTin,
      spplrInvcNo,
      supplierName: toStr(record.spplrNm) ?? 'Unknown supplier',
      supplierPin: spplrTin ?? '',
      supplierId,
      receiptNo: spplrInvcNo ?? existing?.receiptNo ?? 'UNKNOWN',
      invoiceDate: parseKraDate(
        record.salesDt ?? record.cfmDt ?? record.pchsDt,
      ),
      subtotal,
      vat,
      total,
      lineItems,
      paymentTypeCode: toStr(record.pmtTyCd) ?? null,
      rawKraResponse: record,
      pulledAt: new Date(),
    };

    if (existing) {
      Object.assign(existing, fields);
      await this.repo.save(existing);
      return;
    }

    await this.repo.save(
      this.repo.create({
        ...fields,
        confirmationStatus: autoMarkPendingReview ? 'pending_review' : 'pulled',
        erpSyncStatus: 'not_synced',
      }),
    );
  }

  private confirmError(
    row: PurchaseInvoiceOrmEntity,
    message: string,
  ): ConfirmError {
    return { id: row.id, receiptNo: row.receiptNo, message };
  }

  /** `oscu_sync_state` counter for `sendPurchaseTransactionInfo`'s `invcNo` -- a separate sequence from sales' `invoice_seq:*` (see submit-document.usecase.ts), keyed the same way (per kraPin+environment). */
  private async allocatePurchaseInvcNo(
    kraPin: string,
    environment: string,
  ): Promise<number> {
    const syncKey = `purchase_confirm_seq:${kraPin}:${environment}`;
    const existing = await this.syncStateRepo.findOne({ where: { syncKey } });
    const next =
      (existing?.lastReqDt ? parseInt(existing.lastReqDt, 10) : 0) + 1;
    await this.syncStateRepo.upsert({ syncKey, lastReqDt: String(next) }, [
      'syncKey',
    ]);
    return next;
  }

  /** Rolls the counter back on permanent rejection, guarded so it can't stomp a value another request has since advanced past. */
  private async releasePurchaseInvcNo(
    kraPin: string,
    environment: string,
    invcNo: number,
  ): Promise<void> {
    const syncKey = `purchase_confirm_seq:${kraPin}:${environment}`;
    const existing = await this.syncStateRepo.findOne({ where: { syncKey } });
    const current = existing?.lastReqDt ? parseInt(existing.lastReqDt, 10) : 0;
    if (current === invcNo) {
      await this.syncStateRepo.upsert(
        { syncKey, lastReqDt: String(invcNo - 1) },
        ['syncKey'],
      );
    }
  }

  private toDto(row: PurchaseInvoiceOrmEntity): PurchaseInvoiceDto {
    return {
      id: row.id,
      receiptNo: row.receiptNo,
      supplierName: row.supplierName,
      supplierPin: row.supplierPin,
      branch: row.branchName ?? '—',
      invoiceDate: row.invoiceDate,
      subtotal: row.subtotal,
      vat: row.vat,
      total: row.total,
      confirmationStatus: row.confirmationStatus,
      erpSyncStatus: row.erpSyncStatus,
      erpSyncError: row.erpSyncError,
      supplierId: row.supplierId,
      lineItems: row.lineItems,
      kraConfirmError: row.kraConfirmError,
      etimsMetadata: {
        fetchedAt: row.pulledAt.toISOString(),
        controlUnit:
          toStr(row.rawKraResponse?.spplrSdcId) ??
          row.kraBhfId ??
          row.branchName ??
          '—',
        supplierMrcNo: toStr(row.rawKraResponse?.spplrMrcNo) ?? '—',
        receiptType: 'Purchase (Buyer Confirmation)',
        reference:
          row.spplrTin && row.spplrInvcNo
            ? `${row.spplrTin}-${row.spplrInvcNo}`
            : row.id,
      },
    };
  }

  private async resolveMerchantId(complianceTenantId: string): Promise<string> {
    const tenant = await this.organization.getTenantById(complianceTenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${complianceTenantId} not found`);
    }
    if (!tenant.sync2booksCompanyId) {
      throw new BadRequestException(
        'This tenant has no sync2booksCompanyId configured — cannot resolve merchantId',
      );
    }
    return tenant.sync2booksCompanyId;
  }
}
