import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import type { Repository } from 'typeorm';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import {
  MainApiConnectionApplicationService,
  SUPPORTED_INTEGRATION_KEYS,
  type SupportedIntegrationKey,
} from '../../integration/main-api-pull/application/main-api-connection.application.service';
import {
  MainApiPullClient,
  type MainApiSupplier,
} from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { OscuOperationsService } from '../../regulatory/oscu/presentation/oscu-operations.service';
import {
  normalizeName,
  normalizePin,
  sourceSystemForIntegrationKey,
  toContactErpUpdateResult,
  type ContactErpSyncResult,
  type ContactErpUpdateResult,
} from '../../shared/application/erp-contact-sync';
import { SupplierOrmEntity } from '../infrastructure/persistence/supplier.orm-entity';
import type {
  CreateSupplierDto,
  UpdateSupplierDto,
  VerifyKraResponseDto,
} from '../presentation/dto/supplier.dto';

export type PullSuppliersResult = {
  merchantId: string;
  source: SupportedIntegrationKey;
  attempted: number;
  succeeded: number;
  failed: number;
  results: Array<{
    mainApiSupplierId: string;
    supplierId?: string;
    created?: boolean;
    status: 'ok' | 'error';
    error?: string;
  }>;
};

/**
 * Outcome of making sure a dashboard Supplier exists as a vendor in the
 * tenant's connected ERP. `linked` means it now carries a `bookId` —
 * `created` says whether that took a new vendor or adopted one the ERP
 * already had for the same PIN/name.
 */
export type SupplierErpPushResult =
  | { status: 'linked'; supplier: SupplierOrmEntity; created: boolean }
  | { status: 'failed'; supplier: SupplierOrmEntity; error: string }
  | { status: 'skipped'; supplier: SupplierOrmEntity; reason: string };

const SOURCE_DISPLAY_NAME: Record<SupportedIntegrationKey, string> = {
  quickbooks: 'QuickBooks',
  odoo: 'Odoo',
  'microsoft-dynamics-365-business-central': 'Dynamics 365 Business Central',
};

/**
 * Resolves which ERP a supplier pull should target. Mirrors
 * resolveCustomerPullSource in dashboard-customers.application.service.ts —
 * an explicit `source` always wins, otherwise pick whichever supported
 * integration actually has a connectionId rather than defaulting blindly to
 * QuickBooks.
 */
function resolveSupplierPullSource(
  source: string | undefined,
  integrations: Partial<
    Record<SupportedIntegrationKey, { connectionId: string | null }>
  >,
): SupportedIntegrationKey {
  if (source) {
    const key = source.toLowerCase();
    if (!(SUPPORTED_INTEGRATION_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException(
        `Unsupported pull source: ${source}. Must be one of ${SUPPORTED_INTEGRATION_KEYS.join(', ')}`,
      );
    }
    return key as SupportedIntegrationKey;
  }

  const connected = SUPPORTED_INTEGRATION_KEYS.find(
    (key) => integrations?.[key]?.connectionId,
  );
  return connected ?? 'quickbooks';
}

@Injectable()
export class DashboardSuppliersApplicationService {
  private readonly logger = new Logger(
    DashboardSuppliersApplicationService.name,
  );

  constructor(
    @InjectRepository(SupplierOrmEntity)
    private readonly supplierRepo: Repository<SupplierOrmEntity>,
    private readonly oscuOperations: OscuOperationsService,
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
  ) {}

  async list(
    merchantId: string,
    search?: string,
  ): Promise<SupplierOrmEntity[]> {
    const qb = this.supplierRepo
      .createQueryBuilder('s')
      .where('s.merchantId = :merchantId', { merchantId })
      .orderBy('s.createdAt', 'DESC');

    if (search && search.trim() !== '') {
      qb.andWhere('(s.name LIKE :q OR s.tin LIKE :q)', {
        q: `%${search.trim()}%`,
      });
    }

    return qb.getMany();
  }

  async create(input: CreateSupplierDto): Promise<SupplierOrmEntity> {
    const entity = this.supplierRepo.create({
      id: randomUUID(),
      merchantId: input.merchantId,
      name: input.name,
      tin: input.tin ?? null,
      phoneNumber: input.phoneNumber ?? null,
      email: input.email ?? null,
      sourceSystem: input.sourceSystem ?? null,
    });
    return this.supplierRepo.save(entity);
  }

  /**
   * Exact-match lookup by KRA PIN, normalized the same way verifyKra
   * compares candidate PINs. Used by DashboardPurchasesApplicationService to
   * auto-match a purchase invoice's spplrTin against an existing Supplier
   * without duplicating the normalization rule.
   */
  async findByTin(
    merchantId: string,
    tin: string,
  ): Promise<SupplierOrmEntity | null> {
    const normalized = tin.trim().toUpperCase();
    if (!normalized) return null;
    const candidates = await this.supplierRepo.find({ where: { merchantId } });
    return (
      candidates.find(
        (c) => (c.tin ?? '').trim().toUpperCase() === normalized,
      ) ?? null
    );
  }

  /**
   * Add Supplier from the dashboard, optionally pushing it to the ERP in the
   * same request (the dialog's "Sync to ERP" toggle). A failed push never
   * undoes the local row — the outcome is reported in `erp`, and the
   * supplier can be synced again later from the list.
   */
  async createWithErp(
    input: CreateSupplierDto,
  ): Promise<
    SupplierOrmEntity & { erp?: Omit<ContactErpSyncResult, 'id' | 'name'> }
  > {
    const created = await this.create(input);
    if (!input.syncToErp) return created;
    const r = await this.ensureInErpForMerchant(input.merchantId, created.id);
    return Object.assign(r.supplier, {
      erp: {
        status: r.status,
        created: r.status === 'linked' ? r.created : undefined,
        message:
          r.status === 'failed'
            ? r.error
            : r.status === 'skipped'
              ? r.reason
              : undefined,
      },
    });
  }

  /**
   * Saves the edit here, then — when the supplier is already in the connected
   * ERP and the edit carries a field the ERP holds (name, PIN, phone, email) — passes
   * it on through main API, so the vendor there doesn't keep the old details.
   * The ERP outcome rides back as `erp`; a failed ERP update never undoes
   * the local edit.
   */
  async update(
    merchantId: string,
    id: string,
    input: UpdateSupplierDto,
  ): Promise<SupplierOrmEntity & { erp?: ContactErpUpdateResult }> {
    const existing = await this.supplierRepo.findOne({
      where: { id, merchantId },
    });
    if (!existing) throw new NotFoundException(`Supplier ${id} not found`);

    Object.assign(existing, {
      name: input.name ?? existing.name,
      tin: input.tin ?? existing.tin,
      phoneNumber: input.phoneNumber ?? existing.phoneNumber,
      email: input.email ?? existing.email,
    });
    const saved = await this.supplierRepo.save(existing);

    // Any save carrying a field the ERP holds re-sends them -- also how a
    // failed ERP update is retried (saving again, even unchanged).
    const touchesErp = (['name', 'tin', 'phoneNumber', 'email'] as const).some(
      (key) => input[key] !== undefined,
    );
    if (!touchesErp || !saved.bookId) return saved;
    return Object.assign(saved, {
      erp: await this.pushUpdateToErp(merchantId, saved),
    });
  }

  private async pushUpdateToErp(
    merchantId: string,
    supplier: SupplierOrmEntity,
  ): Promise<ContactErpUpdateResult> {
    try {
      const tenant =
        await this.organization.getTenantBySync2booksCompanyId(merchantId);
      if (!tenant) return { status: 'skipped', message: 'Business not found.' };
      const connection = await this.mainApiConnections.getForTenant(tenant.id);
      const integrationKey = SUPPORTED_INTEGRATION_KEYS.find(
        (key) => connection.integrations[key]?.connectionId,
      );
      const connectionId = integrationKey
        ? connection.integrations[integrationKey]?.connectionId
        : null;
      if (!integrationKey || !connectionId) {
        return {
          status: 'skipped',
          message:
            'No accounting system is connected, so only the copy here was updated.',
        };
      }
      if (
        supplier.sourceSystem &&
        supplier.sourceSystem !== sourceSystemForIntegrationKey(integrationKey)
      ) {
        return {
          status: 'skipped',
          message: `This supplier is linked to ${supplier.sourceSystem}, not the accounting system connected now.`,
        };
      }

      const mainApiSupplier = await this.findMainApiSupplierByBookId(
        connection.mainApiApiKey,
        connectionId,
        supplier.bookId!,
      );
      if (!mainApiSupplier) {
        return {
          status: 'failed',
          message: `Couldn't find this vendor in ${SOURCE_DISPLAY_NAME[integrationKey]} any more — pull suppliers, then try again.`,
        };
      }

      const response = await this.mainApiPull.updateSupplier(
        connection.mainApiApiKey,
        mainApiSupplier.id,
        {
          supplierName: supplier.name,
          taxNumber: supplier.tin || undefined,
          emailAddress: supplier.email || undefined,
          phone: supplier.phoneNumber || undefined,
        },
      );
      return toContactErpUpdateResult(response.erpSync);
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async findMainApiSupplierByBookId(
    apiKey: string,
    connectionId: string,
    bookId: string,
  ): Promise<MainApiSupplier | null> {
    let page = 1;
    let totalPages = 1;
    do {
      const response = await this.mainApiPull.getSuppliers(
        apiKey,
        connectionId,
        {
          page,
          limit: 100,
        },
      );
      const match = response.suppliers.find((s) => String(s.bookId) === bookId);
      if (match) return match;
      totalPages = response.totalPages || 1;
      page += 1;
    } while (page <= totalPages && page <= 20);
    return null;
  }

  async getById(merchantId: string, id: string): Promise<SupplierOrmEntity> {
    const found = await this.supplierRepo.findOne({
      where: { id, merchantId },
    });
    if (!found) throw new NotFoundException(`Supplier ${id} not found`);
    return found;
  }

  /**
   * "Verify Supplier on KRA": mirrors DashboardCustomersApplicationService.verifyKra
   * exactly — OSCU's customerPinInfo is a branch-level TIN/PIN batch lookup, not
   * scoped to "customer" in its request payload, so it's reused as-is for a
   * supplier's PIN. See that method's doc comment for the same caveats (stub
   * adapter returns an empty envelope locally, so `found` is always `false`
   * outside a real OSCU connection).
   */
  async verifyKra(
    merchantId: string,
    branchId: string,
    tin: string,
  ): Promise<VerifyKraResponseDto> {
    const response = await this.oscuOperations.customerPinInfo(
      merchantId,
      branchId,
    );
    const raw = (response as { rawResponse?: Record<string, unknown> })
      .rawResponse;
    const data = raw?.data;
    const records = Array.isArray(data) ? data : data ? [data] : [];

    const normalizedTin = tin.trim().toUpperCase();
    const match = records.find((record) => {
      if (typeof record !== 'object' || record === null) return false;
      const r = record as Record<string, unknown>;
      const candidatePin = r.custTin ?? r.custNo ?? r.tin ?? r.pin;
      return (
        typeof candidatePin === 'string' &&
        candidatePin.trim().toUpperCase() === normalizedTin
      );
    }) as Record<string, unknown> | undefined;

    if (!match) {
      return { found: false, taxpayerName: null, raw: response };
    }

    const taxpayerName =
      (match.custNm as string) ??
      (match.taxprNm as string) ??
      (match.name as string) ??
      null;

    return { found: true, taxpayerName, raw: response };
  }

  /**
   * Mirrors DashboardCustomersApplicationService.pullCustomers: best-effort
   * refresh of the main API's ERP cache via sync-from-bookkeeping, then page
   * through GET /suppliers and upsert by externalId (main API's supplier id
   * / bookId) so a re-pull updates existing rows instead of duplicating them.
   */
  async pullSuppliers(
    complianceTenantId: string,
    source?: string,
  ): Promise<PullSuppliersResult> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);

    const pullSource = resolveSupplierPullSource(
      source,
      connection.integrations,
    );
    const connectionId = connection.integrations[pullSource]?.connectionId;
    if (!connectionId) {
      throw new BadRequestException(
        `No connected ${SOURCE_DISPLAY_NAME[pullSource]} connection for this tenant yet — connect ${SOURCE_DISPLAY_NAME[pullSource]} before pulling suppliers.`,
      );
    }

    try {
      await this.mainApiPull.syncSuppliersFromBookkeeping(
        connection.mainApiApiKey,
        connectionId,
      );
    } catch (error) {
      this.logger.warn(
        `sync-from-bookkeeping (suppliers) failed for tenant ${complianceTenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const results: PullSuppliersResult['results'] = [];
    let page = 1;
    const limit = 100;
    let totalPages = 1;

    do {
      const response = await this.mainApiPull.getSuppliers(
        connection.mainApiApiKey,
        connectionId,
        { page, limit },
      );
      totalPages = response.totalPages || 1;

      for (const mainApiSupplier of response.suppliers) {
        try {
          const name =
            mainApiSupplier.supplierName ||
            mainApiSupplier.contactName ||
            'Unnamed supplier';

          const existing = await this.supplierRepo.findOne({
            where: { merchantId, externalId: mainApiSupplier.id },
          });

          const sourceSystem =
            mainApiSupplier.standardized?.sourceSystem ??
            mainApiSupplier.bookType?.toUpperCase() ??
            null;

          if (existing) {
            existing.name = name;
            existing.tin = mainApiSupplier.taxNumber ?? existing.tin;
            existing.phoneNumber =
              mainApiSupplier.phone ?? existing.phoneNumber;
            existing.email = mainApiSupplier.emailAddress ?? existing.email;
            existing.sourceSystem = sourceSystem ?? existing.sourceSystem;
            existing.bookId = mainApiSupplier.bookId ?? existing.bookId;
            const saved = await this.supplierRepo.save(existing);
            results.push({
              mainApiSupplierId: mainApiSupplier.id,
              supplierId: saved.id,
              created: false,
              status: 'ok',
            });
          } else {
            const entity = this.supplierRepo.create({
              id: randomUUID(),
              merchantId,
              externalId: mainApiSupplier.id,
              bookId: mainApiSupplier.bookId ?? null,
              name,
              tin: mainApiSupplier.taxNumber ?? null,
              phoneNumber: mainApiSupplier.phone ?? null,
              email: mainApiSupplier.emailAddress ?? null,
              sourceSystem,
            });
            const saved = await this.supplierRepo.save(entity);
            results.push({
              mainApiSupplierId: mainApiSupplier.id,
              supplierId: saved.id,
              created: true,
              status: 'ok',
            });
          }
        } catch (error) {
          results.push({
            mainApiSupplierId: mainApiSupplier.id,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      page += 1;
    } while (page <= totalPages);

    return {
      merchantId,
      source: pullSource,
      attempted: results.length,
      succeeded: results.filter((r) => r.status === 'ok').length,
      failed: results.filter((r) => r.status === 'error').length,
      results,
    };
  }

  /**
   * Makes sure this Supplier exists as a vendor in the tenant's connected
   * ERP, so a purchase Bill can reference it (`supplierRef.id` must be the
   * ERP's own id — `bookId`). A Supplier created from a purchase's eTIMS
   * data starts life local-only; this is what turns it into a real vendor.
   *
   * Adopts before it creates: the ERP may already hold this vendor (added
   * there directly, or never pulled), and QuickBooks rejects a second
   * vendor with the same display name outright. So it first looks for a
   * main-API supplier with the same PIN (or, failing that, the same name),
   * and on a duplicate-name rejection refreshes main API's vendor cache from
   * the ERP and looks again before giving up.
   */
  async ensureInErp(
    complianceTenantId: string,
    supplierId: string,
  ): Promise<SupplierErpPushResult> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const supplier = await this.getById(merchantId, supplierId);
    if (supplier.bookId) {
      return { status: 'linked', supplier, created: false };
    }

    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);
    const integrationKey = SUPPORTED_INTEGRATION_KEYS.find(
      (key) => connection.integrations[key]?.connectionId,
    );
    const connectionId = integrationKey
      ? connection.integrations[integrationKey]?.connectionId
      : null;
    if (!integrationKey || !connectionId) {
      return {
        status: 'skipped',
        supplier,
        reason:
          'No connected accounting system for this tenant yet — connect QuickBooks or Odoo to create this supplier there.',
      };
    }

    const adopt = async (): Promise<SupplierErpPushResult | null> => {
      const match = await this.findErpVendor(
        connection.mainApiApiKey,
        connectionId,
        supplier,
      );
      if (!match?.bookId) return null;
      supplier.externalId = match.id;
      supplier.bookId = match.bookId;
      supplier.sourceSystem = sourceSystemForIntegrationKey(integrationKey);
      return {
        status: 'linked',
        supplier: await this.supplierRepo.save(supplier),
        created: false,
      };
    };

    try {
      const adopted = await adopt();
      if (adopted) return adopted;

      const response = await this.mainApiPull.createSupplier(
        connection.mainApiApiKey,
        connectionId,
        {
          supplierName: supplier.name,
          taxNumber: supplier.tin ?? undefined,
          emailAddress: supplier.email ?? undefined,
          phone: supplier.phoneNumber ?? undefined,
          status: 'Active',
        },
      );

      if (response.syncedToBookkeeping && response.supplier.bookId) {
        supplier.externalId = response.supplier.id;
        supplier.bookId = String(response.supplier.bookId);
        supplier.sourceSystem = sourceSystemForIntegrationKey(integrationKey);
        return {
          status: 'linked',
          supplier: await this.supplierRepo.save(supplier),
          created: true,
        };
      }

      const error =
        response.syncError ??
        `The supplier was not created in your accounting system (status: ${response.supplier.syncStatus ?? 'unknown'}).`;

      if (/duplicate/i.test(error)) {
        await this.mainApiPull
          .syncSuppliersFromBookkeeping(connection.mainApiApiKey, connectionId)
          .catch((refreshError: unknown) =>
            this.logger.warn(
              `Vendor refresh after duplicate-name rejection failed: ${
                refreshError instanceof Error
                  ? refreshError.message
                  : String(refreshError)
              }`,
            ),
          );
        const adoptedAfterRefresh = await adopt();
        if (adoptedAfterRefresh) return adoptedAfterRefresh;
      }

      return { status: 'failed', supplier, error };
    } catch (error) {
      return {
        status: 'failed',
        supplier,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** ensureInErp for a caller that knows the merchant (Add Supplier), not the tenant. */
  async ensureInErpForMerchant(
    merchantId: string,
    supplierId: string,
  ): Promise<SupplierErpPushResult> {
    const tenant =
      await this.organization.getTenantBySync2booksCompanyId(merchantId);
    if (!tenant)
      throw new NotFoundException(`Business ${merchantId} not found`);
    return this.ensureInErp(tenant.id, supplierId);
  }

  /**
   * Bulk "Sync to ERP" from the Suppliers page: ensureInErp for each id,
   * sequentially (QuickBooks rate-limits, and a later id may be adopted by
   * the vendor refresh an earlier one triggered). One failure never aborts
   * the rest. Ids outside this tenant's merchant come back `failed` (not
   * found), never touched.
   */
  async syncManyToErp(
    complianceTenantId: string,
    ids: string[],
  ): Promise<ContactErpSyncResult[]> {
    if (!ids?.length) throw new BadRequestException('No suppliers selected');
    const results: ContactErpSyncResult[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        const r = await this.ensureInErp(complianceTenantId, id);
        results.push({
          id,
          name: r.supplier.name,
          status: r.status,
          created: r.status === 'linked' ? r.created : undefined,
          message:
            r.status === 'failed'
              ? r.error
              : r.status === 'skipped'
                ? r.reason
                : undefined,
        });
      } catch (error) {
        results.push({
          id,
          name: '',
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /** A main-API supplier (already in the ERP) matching this Supplier by PIN, else by exact name. */
  private async findErpVendor(
    apiKey: string,
    connectionId: string,
    supplier: SupplierOrmEntity,
  ) {
    // Paged rather than name-searched: a PIN match must win even when the
    // ERP spells the vendor's name differently from its eTIMS filing.
    const inErp: MainApiSupplier[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const response = await this.mainApiPull.getSuppliers(
        apiKey,
        connectionId,
        { page, limit: 100 },
      );
      inErp.push(...response.suppliers.filter((s) => s.bookId));
      totalPages = response.totalPages || 1;
      page += 1;
    } while (page <= totalPages && page <= 20);

    const pin = normalizePin(supplier.tin);
    const name = normalizeName(supplier.name);
    return (
      (pin && inErp.find((s) => normalizePin(s.taxNumber) === pin)) ||
      inErp.find(
        (s) =>
          normalizeName(s.supplierName) === name ||
          normalizeName(s.contactName) === name,
      ) ||
      null
    );
  }

  private async resolveMerchantId(complianceTenantId: string): Promise<string> {
    return this.mainApiConnections.resolveMerchantId(complianceTenantId);
  }
}
