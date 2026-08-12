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
