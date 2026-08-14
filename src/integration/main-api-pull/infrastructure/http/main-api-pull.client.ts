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
    return this.get<MainApiListResponse<MainApiInvoice>>(apiKey, '/invoices', params);
  }

  async getInvoiceById(apiKey: string, invoiceId: string): Promise<MainApiInvoice> {
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
    params: { status?: 'Active' | 'Inactive' | 'Archived'; limit?: number; offset?: number } = {},
  ): Promise<MainApiTaxRateListResponse> {
    return this.get<MainApiTaxRateListResponse>(apiKey, '/tax-rates', {
      connectionId,
      status: params.status,
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
    return this.get<MainApiSupplierListResponse>(apiKey, '/suppliers', { connectionId, ...params });
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
    return this.get<MainApiCustomerListResponse>(apiKey, '/customers', { connectionId, ...params });
  }

  /**
   * Triggers a fresh QuickBooks fetch on the main API side before listing —
   * without this, getItems()/getInvoices() only return whatever the main API
   * already happened to have cached, not what's currently in QuickBooks.
   * Best-effort by design: the caller decides whether a failure here should
   * block the read (see DashboardItemsApplicationService).
   */
  async syncItemsFromBookkeeping(apiKey: string, connectionId: string): Promise<unknown> {
    return this.post(apiKey, `/items/connection/${connectionId}/sync-from-bookkeeping`);
  }

  async syncInvoicesFromBookkeeping(apiKey: string, connectionId: string): Promise<unknown> {
    return this.post(apiKey, `/invoices/connection/${connectionId}/sync-from-bookkeeping`);
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
      this.logger.warn(`Main API ${path} failed: ${res.status} ${text.slice(0, 300)}`);
      throw new BadGatewayException(
        `Main API request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    return res.json() as Promise<T>;
  }

  private async get<T>(
    apiKey: string,
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T> {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${this.baseUrl()}${path}${query ? `?${query}` : ''}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Main API ${path} failed: ${res.status} ${text.slice(0, 300)}`);
      throw new BadGatewayException(
        `Main API request failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    return res.json() as Promise<T>;
  }
}
