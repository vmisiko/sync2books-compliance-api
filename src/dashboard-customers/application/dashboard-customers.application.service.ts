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
import { CustomerOrmEntity } from '../infrastructure/persistence/customer.orm-entity';
import type {
  CreateCustomerDto,
  UpdateCustomerDto,
  VerifyKraResponseDto,
} from '../presentation/dto/customer.dto';

export type PullCustomersResult = {
  merchantId: string;
  source: SupportedIntegrationKey;
  attempted: number;
  succeeded: number;
  failed: number;
  results: Array<{
    mainApiCustomerId: string;
    customerId?: string;
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
 * Resolves which ERP a customer pull should target. An explicit `source`
 * (the dashboard's ERP selector, once connected to more than one integration)
 * always wins. Otherwise, don't default to QuickBooks blindly -- a tenant
 * that only has Odoo connected (this API's own go-live test tenant hit this)
 * would silently see "0 synced" forever. Pick whichever supported
 * integration actually has a connectionId instead.
 */
function resolveCustomerPullSource(
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
export class DashboardCustomersApplicationService {
  private readonly logger = new Logger(DashboardCustomersApplicationService.name);

  constructor(
    @InjectRepository(CustomerOrmEntity)
    private readonly customerRepo: Repository<CustomerOrmEntity>,
    private readonly oscuOperations: OscuOperationsService,
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
  ) {}

  async list(merchantId: string, search?: string): Promise<CustomerOrmEntity[]> {
    const qb = this.customerRepo
      .createQueryBuilder('c')
      .where('c.merchantId = :merchantId', { merchantId })
      .orderBy('c.createdAt', 'DESC');

    if (search && search.trim() !== '') {
      qb.andWhere('(c.name LIKE :q OR c.tin LIKE :q)', {
        q: `%${search.trim()}%`,
      });
    }

    return qb.getMany();
  }

  async create(input: CreateCustomerDto): Promise<CustomerOrmEntity> {
    const entity = this.customerRepo.create({
      id: randomUUID(),
      merchantId: input.merchantId,
      name: input.name,
      tin: input.tin ?? null,
      phoneNumber: input.phoneNumber ?? null,
      email: input.email ?? null,
    });
    return this.customerRepo.save(entity);
  }

  async update(
    merchantId: string,
    id: string,
    input: UpdateCustomerDto,
  ): Promise<CustomerOrmEntity> {
    const existing = await this.customerRepo.findOne({
      where: { id, merchantId },
    });
    if (!existing) throw new NotFoundException(`Customer ${id} not found`);

    Object.assign(existing, {
      name: input.name ?? existing.name,
      tin: input.tin ?? existing.tin,
      phoneNumber: input.phoneNumber ?? existing.phoneNumber,
      email: input.email ?? existing.email,
    });
    return this.customerRepo.save(existing);
  }

  async getById(merchantId: string, id: string): Promise<CustomerOrmEntity> {
    const found = await this.customerRepo.findOne({
      where: { id, merchantId },
    });
    if (!found) throw new NotFoundException(`Customer ${id} not found`);
    return found;
  }

  /**
   * "Verify Customer on KRA": OSCU has no live single-PIN lookup — the closest
   * real capability is `customerPinInfo`, which pulls the batch of customer/PIN
   * records KRA has synced to this device. We fetch that batch and search it
   * for a matching PIN. Confirm the actual field names (`custTin`/`custNm` etc.)
   * against a live sandbox response before relying on this in production — the
   * stub adapter used locally returns an empty envelope, so `found` will always
   * be `false` outside a real OSCU connection.
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
   * Mirrors DashboardItemsApplicationService.pullItems: best-effort refresh
   * of the main API's QuickBooks cache, then page through GET /customers and
   * upsert by externalId (main API's customer id / bookId) so a re-pull
   * updates existing rows instead of duplicating them.
   */
  async pullCustomers(
    complianceTenantId: string,
    source?: string,
  ): Promise<PullCustomersResult> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const connection =
      await this.mainApiConnections.getForTenant(complianceTenantId);

    const pullSource = resolveCustomerPullSource(
      source,
      connection.integrations,
    );
    const connectionId = connection.integrations[pullSource]?.connectionId;
    if (!connectionId) {
      throw new BadRequestException(
        `No connected ${SOURCE_DISPLAY_NAME[pullSource]} connection for this tenant yet — connect ${SOURCE_DISPLAY_NAME[pullSource]} before pulling customers.`,
      );
    }

    try {
      await this.mainApiPull.syncCustomersFromBookkeeping(
        connection.mainApiApiKey,
        connectionId,
      );
    } catch (error) {
      this.logger.warn(
        `sync-from-bookkeeping (customers) failed for tenant ${complianceTenantId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const results: PullCustomersResult['results'] = [];
    let page = 1;
    const limit = 100;
    let totalPages = 1;

    do {
      const response = await this.mainApiPull.getCustomers(
        connection.mainApiApiKey,
        connectionId,
        { page, limit },
      );
      totalPages = response.totalPages || 1;

      for (const mainApiCustomer of response.customers) {
        try {
          const name =
            mainApiCustomer.companyName ||
            mainApiCustomer.name ||
            [mainApiCustomer.givenName, mainApiCustomer.familyName]
              .filter(Boolean)
              .join(' ') ||
            'Unnamed customer';

          const existing = await this.customerRepo.findOne({
            where: { merchantId, externalId: mainApiCustomer.id },
          });

          if (existing) {
            existing.name = name;
            existing.tin = mainApiCustomer.taxId ?? existing.tin;
            existing.phoneNumber = mainApiCustomer.phone ?? existing.phoneNumber;
            existing.email = mainApiCustomer.email ?? existing.email;
            const saved = await this.customerRepo.save(existing);
            results.push({
              mainApiCustomerId: mainApiCustomer.id,
              customerId: saved.id,
              created: false,
              status: 'ok',
            });
          } else {
            const entity = this.customerRepo.create({
              id: randomUUID(),
              merchantId,
              externalId: mainApiCustomer.id,
              name,
              tin: mainApiCustomer.taxId ?? null,
              phoneNumber: mainApiCustomer.phone ?? null,
              email: mainApiCustomer.email ?? null,
            });
            const saved = await this.customerRepo.save(entity);
            results.push({
              mainApiCustomerId: mainApiCustomer.id,
              customerId: saved.id,
              created: true,
              status: 'ok',
            });
          }
        } catch (error) {
          results.push({
            mainApiCustomerId: mainApiCustomer.id,
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
