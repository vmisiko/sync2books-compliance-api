import { Injectable, Logger, BadGatewayException } from '@nestjs/common';

export interface MainApiItem {
  id: string;
  itemCode: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  active: boolean;
  itemType?: string | null;
  unitOfMeasure?: string | null;
  unitPrice?: number | null;
  defaultTaxCodeRef?: { id: string; name?: string } | null;
  bookId?: string | null;
  bookType?: string | null;
}

export interface MainApiInvoiceLineItem {
  description?: string;
  unitAmount: number;
  quantity: number;
  taxAmount?: number;
  totalAmount?: number;
  itemRef?: { id: string; name?: string };
  taxRateRef?: { id: string; name?: string };
}

export interface MainApiInvoice {
  id: string;
  invoiceCode: string;
  reference?: string;
  issueDate: string;
  currency: string;
  lineItems: MainApiInvoiceLineItem[];
  status: string;
  subTotal: number;
  taxAmount: number;
  totalAmount: number;
  customerRef?: { id: string; companyName?: string };
}

export interface MainApiListResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** IntegrationKeyType values the main API's connection/company endpoints accept. */
export type MainApiIntegrationKey =
  | 'quickbooks'
  | 'xero'
  | 'sage'
  | 'microsoft-dynamics-365-business-central'
  | 'odoo';

export interface MainApiConnectionRecord {
  id: string;
  integrationKey: MainApiIntegrationKey;
  companyId: string;
  bookCompanyId: string;
  status:
    | 'pending'
    | 'awaiting_company_selection'
    | 'connected'
    | 'disconnected';
}

export interface MainApiDynamicsCompany {
  id: string;
  name: string;
  displayName: string;
}

export interface MainApiOdooCredentials {
  url: string;
  database: string;
  username: string;
  apiKey: string;
}

/**
 * Shape confirmed against the main API's own source
 * (nest-sync-2-books-api/src/tax-rate/domain/entities/tax-rate.entity.ts +
 * .../application/dtos/tax-rate-list-response.dto.ts) rather than assumed —
 * note this is a real Tax Rate resource (status/effectiveTaxRate/etc), not
 * the simpler {id,name,rate,status} shape a first guess might reach for.
 */
export interface MainApiTaxRate {
  id: string;
  /** Display name for generic use, e.g. "Standard VAT". */
  name: string;
  /** QuickBooks-specific display name, when present — often the more human-readable label (e.g. "16% Standard VAT"). */
  displayName?: string | null;
  status: 'Active' | 'Inactive' | 'Archived';
  /** The effective tax rate percentage (e.g. 16 for 16%). */
  effectiveTaxRate: number;
  /** The total tax rate percentage across all components. */
  totalTaxRate: number;
  connectionId: string;
  bookType?: string | null;
}

export interface MainApiTaxRateListResponse {
  taxRates: MainApiTaxRate[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * QuickBooks' SalesItemLineDetail.TaxCodeRef needs a TaxCode id, not a
 * TaxRate id — a TaxRate is just the percentage detail a TaxCode wraps
 * (`salesTaxRateRefs`/`purchaseTaxRateRefs`), it isn't itself assignable to
 * a transaction line. This shape is built against the main API's TaxCode
 * sync contract as frozen for this task (that sync is landing in a parallel
 * task on nest-sync-2-books-api and was not live/confirmed at the time this
 * was written) — mirrors the existing tax-rates endpoints' DTO shape:
 * standard synced-entity fields (id/applicationId/companyId/connectionId/
 * bookId/syncToken/bookResponseData/bookType/syncStatus/syncError/
 * createdAt/updatedAt/lastSyncAt) plus TaxCode-specific fields below.
 */
export interface MainApiTaxCodeRateRef {
  id: string;
  name: string;
}

export interface MainApiTaxCode {
  id: string;
  applicationId?: string | null;
  companyId?: string | null;
  connectionId: string;
  bookId?: string | null;
  syncToken?: string | null;
  bookResponseData?: unknown;
  bookType?: string | null;
  syncStatus?: string | null;
  syncError?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lastSyncAt?: string | null;
  /** e.g. "16.0% S", "0.0% Z", "Exempt Sale", "No VAT". */
  name: string;
  /** e.g. "Standard", "Zero-rated", "Exempt from VAT", "Out of Scope of VAT". */
  description?: string | null;
  active: boolean;
  taxable: boolean;
  taxGroup: boolean;
  /** Can be empty for purchase-only codes. */
  salesTaxRateRefs: MainApiTaxCodeRateRef[];
  /** Can be empty for sales-only codes. */
  purchaseTaxRateRefs: MainApiTaxCodeRateRef[];
}

export interface MainApiTaxCodeListResponse {
  taxCodes: MainApiTaxCode[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Minimal shapes for /suppliers and /customers — not wired into any pull
 * flow yet (see MainApiPullClient.getSuppliers/getCustomers doc comments).
 * Confirmed against nest-sync-2-books-api's own list-response DTOs:
 * src/supplier/application/dtos/supplier-list-response.dto.ts and
 * src/customer/application/dtos/customer-list-response.dto.ts.
 */
export interface MainApiSupplier {
  id: string;
  supplierName?: string | null;
  taxNumber?: string | null;
  bookType?: string | null;
}

export interface MainApiSupplierListResponse {
  suppliers: MainApiSupplier[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface MainApiCustomer {
  id: string;
  name: string;
  companyName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  taxId?: string | null;
  bookType?: string | null;
}

export interface MainApiCustomerListResponse {
  customers: MainApiCustomer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * compliance-api pulling from the main Sync2Books API as a registered
 * Application (its own x-api-key per compliance tenant) — see
 * THREE_SERVICE_TRUST_AND_CONNECTION_ARCHITECTURE.md. Mirrors the fetch-based
 * style already used by Sync2BooksMainApiOscuClient rather than adding axios.
 */
@Injectable()
export class MainApiPullClient {
  private readonly logger = new Logger(MainApiPullClient.name);

  private baseUrl(): string {
    const base = process.env.MAIN_API_BASE_URL?.trim();
    if (!base) {
      throw new BadGatewayException('MAIN_API_BASE_URL is not configured');
    }
    return base.replace(/\/?$/, '');
  }

  async getItems(
    apiKey: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<MainApiListResponse<MainApiItem>> {
    return this.get<MainApiListResponse<MainApiItem>>(apiKey, '/items', params);
  }

  async getInvoices(
    apiKey: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<MainApiListResponse<MainApiInvoice>> {
    return this.get<MainApiListResponse<MainApiInvoice>>(
      apiKey,
      '/invoices',
      params,
    );
  }

  async getInvoiceById(
    apiKey: string,
    invoiceId: string,
  ): Promise<MainApiInvoice> {
    return this.get<MainApiInvoice>(apiKey, `/invoices/${invoiceId}`, {});
  }

  /**
   * GET /tax-rates?connectionId=... — real route confirmed against
   * nest-sync-2-books-api/src/tax-rate/controllers/tax-rate.controller.ts
   * (query-param filtered, same as getItems/getInvoices' page/limit style),
   * not the /connections/{connectionId}/tax-rates path that a first read of
   * the docs might suggest. connectionId is required by that controller's
   * intent (a company can have more than one ERP connection) even though
   * it's technically optional on the query DTO.
   */
  async getTaxRates(
    apiKey: string,
    connectionId: string,
    params: {
      status?: 'Active' | 'Inactive' | 'Archived';
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<MainApiTaxRateListResponse> {
    return this.get<MainApiTaxRateListResponse>(apiKey, '/tax-rates', {
      connectionId,
      status: params.status,
      limit: params.limit,
      offset: params.offset,
    });
  }

  /**
   * GET /tax-codes?connectionId=... — sibling to getTaxRates, added the same
   * way (query-param filtered, connectionId required by intent though
   * technically optional on the query DTO). Built against the frozen
   * contract for the main API's TaxCode sync (see MainApiTaxCode's doc
   * comment) rather than a confirmed-live route — the main API's TaxCode
   * sync was landing in a parallel task, not done yet when this was written.
   */
  async getTaxCodes(
    apiKey: string,
    connectionId: string,
    params: {
      status?: 'Active' | 'Inactive' | 'Archived';
      active?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<MainApiTaxCodeListResponse> {
    return this.get<MainApiTaxCodeListResponse>(apiKey, '/tax-codes', {
      connectionId,
      status: params.status,
      active: params.active,
      limit: params.limit,
      offset: params.offset,
    });
  }

  /**
   * GET /suppliers?connectionId=... — not consumed anywhere yet. Kept here
   * so a future pass can resolve sales-line supplier references to a real
   * name/TIN instead of the raw QuickBooks ref; not needed for tax/unit/
   * classification mapping (Track B's actual scope).
   */
  async getSuppliers(
    apiKey: string,
    connectionId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<MainApiSupplierListResponse> {
    return this.get<MainApiSupplierListResponse>(apiKey, '/suppliers', {
      connectionId,
      ...params,
    });
  }

  /**
   * GET /customers?connectionId=... — same status as getSuppliers: wired up
   * for later use resolving sales-line customerName/customerTin, not used by
   * anything in this pass.
   */
  async getCustomers(
    apiKey: string,
    connectionId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<MainApiCustomerListResponse> {
    return this.get<MainApiCustomerListResponse>(apiKey, '/customers', {
      connectionId,
      ...params,
    });
  }

  /**
   * Companies & connections: POST /companies (see
   * concepts/companies-and-connections.mdx in sync2BooksDocumentation). Also
   * returns a QuickBooks authUrl by default, which we ignore here — the
   * dashboard drives auth via the Sync2BooksLink widget instead.
   */
  async createCompany(
    apiKey: string,
    name: string,
  ): Promise<{ company: { id: string; name: string } }> {
    return this.postJson<{ company: { id: string; name: string } }>(
      apiKey,
      '/companies',
      { name },
    );
  }

  /**
   * GET /companies/:id, treating 404 as "doesn't exist" rather than an error —
   * lets ensureCompanyLocked() tell a stale/deleted mainApiCompanyId apart
   * from a genuinely live one instead of trusting the cached id blindly.
   */
  async companyExists(apiKey: string, companyId: string): Promise<boolean> {
    const url = `${this.baseUrl()}/companies/${companyId}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 404) return false;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `Main API GET /companies/${companyId} failed: ${res.status} ${text.slice(0, 300)}`,
      );
      throw new BadGatewayException(
        `Main API request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    return true;
  }

  /**
   * Triggers a fresh QuickBooks fetch on the main API side before listing —
   * without this, getItems()/getInvoices() only return whatever the main API
   * already happened to have cached, not what's currently in QuickBooks.
   * Best-effort by design: the caller decides whether a failure here should
   * block the read (see DashboardItemsApplicationService).
   */
  async syncItemsFromBookkeeping(
    apiKey: string,
    connectionId: string,
  ): Promise<unknown> {
    return this.post(
      apiKey,
      `/items/connection/${connectionId}/sync-from-bookkeeping`,
    );
  }

  async syncInvoicesFromBookkeeping(
    apiKey: string,
    connectionId: string,
  ): Promise<unknown> {
    return this.post(
      apiKey,
      `/invoices/connection/${connectionId}/sync-from-bookkeeping`,
    );
  }

  /** Sibling to syncItemsFromBookkeeping/syncInvoicesFromBookkeeping -- see customer.controller.ts's identical route on the main API. */
  async syncCustomersFromBookkeeping(
    apiKey: string,
    connectionId: string,
  ): Promise<unknown> {
    return this.post(
      apiKey,
      `/customers/connection/${connectionId}/sync-from-bookkeeping`,
    );
  }

  // --- Sync2Books Link (ERP connect widget) proxy calls ---
  // Mirrors src/lib/sync2books-link/client.ts in sync2books-react, but kept
  // server-side here so the main-API key never reaches the browser.

  async getAuthUrl(
    apiKey: string,
    companyId: string,
    integrationKey: MainApiIntegrationKey,
    connectionId?: string,
  ): Promise<{ authUrl: string }> {
    return this.get<{ authUrl: string }>(
      apiKey,
      `/companies/${companyId}/auth-url`,
      {
        integrationKey,
        connectionId,
      },
    );
  }

  async getConnectionByIntegration(
    apiKey: string,
    companyId: string,
    integrationKey: MainApiIntegrationKey,
  ): Promise<MainApiConnectionRecord | null> {
    return this.get<MainApiConnectionRecord | null>(
      apiKey,
      `/connections/company/${companyId}/integration/${integrationKey}`,
      {},
    );
  }

  async listDynamicsCompanies(
    apiKey: string,
    connectionId: string,
  ): Promise<MainApiDynamicsCompany[]> {
    return this.get<MainApiDynamicsCompany[]>(
      apiKey,
      `/connections/${connectionId}/dynamics/companies`,
      {},
    );
  }

  async finalizeDynamicsConnection(
    apiKey: string,
    connectionId: string,
    bookCompanyId: string,
  ): Promise<MainApiConnectionRecord> {
    return this.postJson<MainApiConnectionRecord>(
      apiKey,
      `/connections/${connectionId}/dynamics/finalize`,
      {
        bookCompanyId,
      },
    );
  }

  async connectOdoo(
    apiKey: string,
    companyId: string,
    credentials: MainApiOdooCredentials,
    connectionId?: string,
  ): Promise<MainApiConnectionRecord> {
    return this.postJson<MainApiConnectionRecord>(
      apiKey,
      `/companies/${companyId}/odoo/connect`,
      {
        ...credentials,
        connectionId,
      },
    );
  }

  async disconnectConnection(
    apiKey: string,
    connectionId: string,
  ): Promise<{ status: string }> {
    return this.postJson<{ status: string }>(
      apiKey,
      `/connections/${connectionId}/disconnect`,
      undefined,
    );
  }

  // --- Webhooks (outbound from the main API's perspective, inbound to us) ---
  // See WEBHOOK_SYSTEM.md in nest-sync-2-books-api. compliance-api registers
  // itself as a subscriber, same as any third-party integrator would.

  async createWebhookEndpoint(
    apiKey: string,
    input: { name: string; url: string; eventTypes: string[] },
  ): Promise<{
    id: string;
    secret: string;
    url: string;
    eventTypes: string[];
  }> {
    return this.postJson(apiKey, '/webhooks/endpoints', input);
  }

  async updateWebhookEndpointUrl(
    apiKey: string,
    endpointId: string,
    url: string,
  ): Promise<{ id: string; url: string }> {
    return this.putJson(apiKey, `/webhooks/endpoints/${endpointId}`, { url });
  }

  /**
   * POST /webhooks/endpoints can't create an endpoint scoped to "any
   * environment" — the main API's own controller defaults a missing
   * environment to its runtime NODE_ENV rather than leaving it null. PUT
   * does respect an explicit null, so we always follow creation with this.
   */
  async setWebhookEndpointEnvironmentToAny(
    apiKey: string,
    endpointId: string,
  ): Promise<void> {
    await this.putJson(apiKey, `/webhooks/endpoints/${endpointId}`, {
      environment: null,
    });
  }

  private async post<T>(apiKey: string, path: string): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `Main API ${path} failed: ${res.status} ${text.slice(0, 300)}`,
      );
      throw new BadGatewayException(
        `Main API request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    return res.json() as Promise<T>;
  }

  private async postJson<T>(
    apiKey: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `Main API ${path} failed: ${res.status} ${text.slice(0, 300)}`,
      );
      throw new BadGatewayException(
        `Main API request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    return res.json() as Promise<T>;
  }

  private async putJson<T>(
    apiKey: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `Main API ${path} failed: ${res.status} ${text.slice(0, 300)}`,
      );
      throw new BadGatewayException(
        `Main API request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    return res.json() as Promise<T>;
  }

  private async get<T>(
    apiKey: string,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(
        ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
      )
      .join('&');
    const url = `${this.baseUrl()}${path}${query ? `?${query}` : ''}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `Main API ${path} failed: ${res.status} ${text.slice(0, 300)}`,
      );
      throw new BadGatewayException(
        `Main API request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    return res.json() as Promise<T>;
  }
}
