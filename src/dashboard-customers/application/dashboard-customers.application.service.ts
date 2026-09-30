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
  type MainApiCustomer,
} from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import {
  normalizeName,
  normalizePin,
  sourceSystemForIntegrationKey,
  type ContactErpSyncResult,
} from '../../shared/application/erp-contact-sync';
import { OscuOperationsService } from '../../regulatory/oscu/presentation/oscu-operations.service';
import { CustomerOrmEntity } from '../infrastructure/persistence/customer.orm-entity';
import type {
  CreateCustomerDto,
  UpdateCustomerDto,
  VerifyKraResponseDto,
} from '../presentation/dto/customer.dto';

/** Outcome of making sure a dashboard Customer exists in the connected ERP — see ensureInErp. */
export type CustomerErpPushResult =
  | { status: 'linked'; customer: CustomerOrmEntity; created: boolean }
  | { status: 'failed'; customer: CustomerOrmEntity; error: string }
  | { status: 'skipped'; customer: CustomerOrmEntity; reason: string };

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
  private readonly logger = new Logger(
    DashboardCustomersApplicationService.name,
  );

  constructor(
    @InjectRepository(CustomerOrmEntity)
    private readonly customerRepo: Repository<CustomerOrmEntity>,
    private readonly oscuOperations: OscuOperationsService,
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
  ) {}

  async list(
    merchantId: string,
    search?: string,
  ): Promise<CustomerOrmEntity[]> {
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

  /**
   * Matches a pulled invoice's `customerRef.id` back to the customer this
   * merchant already pulled/stored (mirrors ICatalogItemRepository
   * .findByMerchantAndExternalId for line items) -- lets a pulled invoice
   * reuse the customer's already-known PIN/phone/email instead of asking
   * the user to retype a PIN they already entered on the Customers page.
   * sourceSystem-scoped for the same reason items are: two ERPs can share
   * the same small numeric externalId for this merchant.
   */
  async findByExternalId(
    merchantId: string,
    externalId: string,
    sourceSystem?: string | null,
  ): Promise<CustomerOrmEntity | null> {
    return this.customerRepo.findOne({
      where: {
        merchantId,
        externalId,
        ...(sourceSystem ? { sourceSystem } : {}),
      },
    });
  }

  async create(input: CreateCustomerDto): Promise<CustomerOrmEntity> {
    const entity = this.customerRepo.create({
      id: randomUUID(),
      merchantId: input.merchantId,
      name: input.name,
      tin: input.tin ?? null,
      phoneNumber: input.phoneNumber ?? null,
      email: input.email ?? null,
      taxExempt: input.taxExempt ?? false,
    });
    return this.customerRepo.save(entity);
  }

  /**
   * Add Customer from the dashboard, optionally pushing it to the ERP in the
   * same request (the dialog's "Sync to ERP" toggle). A failed push never
   * undoes the local row — the outcome is reported in `erp`, and the
   * customer can be synced again later from the list.
   */
  async createWithErp(input: CreateCustomerDto): Promise<
    CustomerOrmEntity & { erp?: Omit<ContactErpSyncResult, 'id' | 'name'> }
  > {
    const created = await this.create(input);
    if (!input.syncToErp) return created;
    const r = await this.ensureInErpForMerchant(input.merchantId, created.id);
    return Object.assign(r.customer, {
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
      taxExempt: input.taxExempt ?? existing.taxExempt,
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

          // mainApiCustomer.id is main API's own record id (returned as its
          // customerCode, prefixed per ERP -- "QB_13") -- NOT what a pulled
          // invoice's customerRef.id carries (the raw, unprefixed ERP id).
          // bookId is that raw id; storing it here is what lets
          // DashboardInvoicesApplicationService.enrich() match a pulled
          // invoice's customer back to this row later. See MainApiCustomer's
          // doc comment.
          const externalId = mainApiCustomer.bookId ?? mainApiCustomer.id;
          const existing = await this.customerRepo.findOne({
            where: { merchantId, externalId },
          });

          const sourceSystem =
            mainApiCustomer.standardized?.sourceSystem ??
            mainApiCustomer.bookType?.toUpperCase() ??
            null;

          if (existing) {
            existing.name = name;
            existing.tin = mainApiCustomer.taxId ?? existing.tin;
            existing.phoneNumber =
              mainApiCustomer.phone ?? existing.phoneNumber;
            existing.email = mainApiCustomer.email ?? existing.email;
            existing.sourceSystem = sourceSystem ?? existing.sourceSystem;
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
              externalId,
              name,
              tin: mainApiCustomer.taxId ?? null,
              phoneNumber: mainApiCustomer.phone ?? null,
              email: mainApiCustomer.email ?? null,
              sourceSystem,
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

  /**
   * Makes sure this Customer exists in the tenant's connected ERP. Mirrors
   * DashboardSuppliersApplicationService.ensureInErp: adopt a main-API
   * customer with the same PIN (else exact name) before creating one, and
   * on a duplicate-name rejection refresh main API's cache from the ERP and
   * look again.
   *
   * "In the ERP" for a customer means `externalId` is set: a pull stores
   * the ERP's own id there (not main API's prefixed record id — see
   * pullCustomers), which is what DashboardInvoicesApplicationService
   * matches a pulled invoice's customerRef against. A push stores the same
   * value, so a pushed customer and a pulled one are interchangeable.
   */
  async ensureInErp(
    complianceTenantId: string,
    customerId: string,
  ): Promise<CustomerErpPushResult> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const customer = await this.getById(merchantId, customerId);
    if (customer.externalId) {
      return { status: 'linked', customer, created: false };
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
        customer,
        reason:
          'No connected accounting system for this tenant yet — connect QuickBooks or Odoo to create this customer there.',
      };
    }

    const link = async (bookId: string) => {
      customer.externalId = bookId;
      customer.sourceSystem = sourceSystemForIntegrationKey(integrationKey);
      return this.customerRepo.save(customer);
    };
    const adopt = async (): Promise<CustomerErpPushResult | null> => {
      const match = await this.findErpCustomer(
        connection.mainApiApiKey,
        connectionId,
        customer,
      );
      if (!match?.bookId) return null;
      return {
        status: 'linked',
        customer: await link(match.bookId),
        created: false,
      };
    };

    try {
      const adopted = await adopt();
      if (adopted) return adopted;

      const response = await this.mainApiPull.createCustomer(
        connection.mainApiApiKey,
        connectionId,
        {
          name: customer.name,
          taxId: customer.tin ?? undefined,
          email: customer.email ?? undefined,
          phone: customer.phoneNumber ?? undefined,
          // Main API defaults a customer's currency to USD when none is sent,
          // and QuickBooks rejects a USD customer in a single-currency (KES)
          // company ("Multi Currency should be enabled"). Everything this
          // platform handles is KES -- same assumption as the purchase Bill push.
          currency: 'KES',
        },
      );

      if (response.syncedToBookkeeping && response.customer.bookId) {
        return {
          status: 'linked',
          customer: await link(String(response.customer.bookId)),
          created: true,
        };
      }

      const error =
        response.syncError ??
        `The customer was not created in your accounting system (status: ${response.customer.syncStatus ?? 'unknown'}).`;

      if (/duplicate/i.test(error)) {
        await this.mainApiPull
          .syncCustomersFromBookkeeping(connection.mainApiApiKey, connectionId)
          .catch((refreshError: unknown) =>
            this.logger.warn(
              `Customer refresh after duplicate-name rejection failed: ${
                refreshError instanceof Error
                  ? refreshError.message
                  : String(refreshError)
              }`,
            ),
          );
        const adoptedAfterRefresh = await adopt();
        if (adoptedAfterRefresh) return adoptedAfterRefresh;
      }

      return { status: 'failed', customer, error };
    } catch (error) {
      return {
        status: 'failed',
        customer,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** ensureInErp for a caller that knows the merchant (Add Customer), not the tenant. */
  async ensureInErpForMerchant(
    merchantId: string,
    customerId: string,
  ): Promise<CustomerErpPushResult> {
    const tenant =
      await this.organization.getTenantBySync2booksCompanyId(merchantId);
    if (!tenant) throw new NotFoundException(`Business ${merchantId} not found`);
    return this.ensureInErp(tenant.id, customerId);
  }

  /** Bulk "Sync to ERP" from the Customers page — see the suppliers twin. */
  async syncManyToErp(
    complianceTenantId: string,
    ids: string[],
  ): Promise<ContactErpSyncResult[]> {
    if (!ids?.length) throw new BadRequestException('No customers selected');
    const results: ContactErpSyncResult[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        const r = await this.ensureInErp(complianceTenantId, id);
        results.push({
          id,
          name: r.customer.name,
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

  /** A main-API customer (already in the ERP) matching this Customer by PIN, else by exact name. */
  private async findErpCustomer(
    apiKey: string,
    connectionId: string,
    customer: CustomerOrmEntity,
  ): Promise<MainApiCustomer | null> {
    const inErp: MainApiCustomer[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const response = await this.mainApiPull.getCustomers(
        apiKey,
        connectionId,
        { page, limit: 100 },
      );
      inErp.push(...response.customers.filter((c) => c.bookId));
      totalPages = response.totalPages || 1;
      page += 1;
    } while (page <= totalPages && page <= 20);

    const pin = normalizePin(customer.tin);
    const name = normalizeName(customer.name);
    return (
      (pin && inErp.find((c) => normalizePin(c.taxId) === pin)) ||
      inErp.find(
        (c) =>
          normalizeName(c.name) === name ||
          normalizeName(c.companyName) === name,
      ) ||
      null
    );
  }

  private async resolveMerchantId(complianceTenantId: string): Promise<string> {
    return this.mainApiConnections.resolveMerchantId(complianceTenantId);
  }
}
