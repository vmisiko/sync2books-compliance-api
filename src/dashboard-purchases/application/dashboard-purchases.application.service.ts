import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { OscuOperationsService } from '../../regulatory/oscu/presentation/oscu-operations.service';
import {
  PurchaseInvoiceOrmEntity,
  type PurchaseLineItemJson,
} from '../infrastructure/persistence/purchase-invoice.orm-entity';

/** KRA's own sample `lastReqDt` for a first-ever pull (OSCU spec §3.3.3.1 JSON SAMPLE). */
const EPOCH_LAST_REQ_DT = '20180523000000';

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
  lineItems: PurchaseLineItemJson[];
  etimsMetadata: {
    fetchedAt: string;
    controlUnit: string;
    receiptType: string;
    signatureHash: string;
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
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly oscuOperations: OscuOperationsService,
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
        const records = Array.isArray((data as { saleList?: unknown })?.saleList)
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

  async confirm(
    complianceTenantId: string,
    ids: string[],
  ): Promise<{ data: PurchaseInvoiceDto[]; total: number }> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const rows = await this.repo.find({ where: { merchantId } });
    const toUpdate = rows.filter(
      (r) => ids.includes(r.id) && r.supplierPin !== '',
    );
    for (const row of toUpdate) row.confirmationStatus = 'confirmed';
    await this.repo.save(toUpdate);
    return this.list(complianceTenantId);
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

  /**
   * `sendPurchaseTransactionInfo` is a real, working OSCU write
   * (`OscuOperationsService.sendPurchaseTransaction`) — but it confirms the
   * purchase to *KRA*, a genuinely separate 2-party flow requiring the
   * purchased item to already exist in our own catalog under our own
   * `itemCd` (see oscu-payload-gotchas.md). ERP sync-back is a third,
   * unrelated thing this button asks for and has no implementation yet.
   */
  syncToErp(_complianceTenantId: string, ids: string[]): never {
    if (!ids?.length) {
      throw new BadRequestException('No purchase invoices selected');
    }
    throw new BadRequestException(
      'ERP sync for purchase invoices is not available yet. Coming soon.',
    );
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
      const unitPrice = toNumber(item.prc) ?? (qty ? (total - taxAmount) / qty : total);
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

    const fields = {
      merchantId,
      branchId: branch.id,
      branchName: branch.displayName,
      kraBhfId: branch.kraBhfId,
      spplrTin,
      spplrInvcNo,
      supplierName: toStr(record.spplrNm) ?? 'Unknown supplier',
      supplierPin: spplrTin ?? '',
      receiptNo: spplrInvcNo ?? existing?.receiptNo ?? 'UNKNOWN',
      invoiceDate: parseKraDate(record.salesDt ?? record.cfmDt ?? record.pchsDt),
      subtotal,
      vat,
      total,
      lineItems,
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
      lineItems: row.lineItems,
      etimsMetadata: {
        fetchedAt: row.pulledAt.toISOString(),
        controlUnit: row.kraBhfId ?? row.branchName ?? '—',
        receiptType: 'Purchase (Buyer Confirmation)',
        signatureHash:
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
