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
import { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { OscuOperationsService } from '../../regulatory/oscu/presentation/oscu-operations.service';
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

  async update(
    merchantId: string,
    id: string,
    input: UpdateSupplierDto,
  ): Promise<SupplierOrmEntity> {
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
    return this.supplierRepo.save(existing);
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
