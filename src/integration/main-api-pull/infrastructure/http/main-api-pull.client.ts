import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { SourceSystem } from '../../../../shared/domain/enums/source-system.enum';

/**
 * Mirrors main-api's Address (nest-sync-2-books-api/src/standardization/domain/entities/shared.ts)
 * closely enough for our own `standardized` fields below — own copy since main-api and
 * compliance-api are separate deployables with no shared package.
 */
export interface MainApiStandardizedAddress {
  type: 'Unknown' | 'Billing' | 'Delivery';
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  country?: string;
  postalCode?: string;
}

/**
 * Main API's actual, Codat-faithful item-type vocabulary — deliberately not collapsed to a
 * GOODS/SERVICE bucket there (see standardized-item.mapper.ts#collapseItemType, which does that
 * collapse in this repo instead, since it's a KRA-specific simplification).
 */
export type MainApiStandardizedItemType = 'Unknown' | 'Inventory' | 'NonInventory' | 'Service';

/**
 * Additive, computed-at-response-time normalization main API now attaches to every Item row (or
 * null if that row's source ERP isn't standardized yet) — see the standardization refactor that
 * moved ERP-shape parsing (QuickBooks Type/SalesTaxCodeRef field-name differences, etc.) out of
 * this repo and into main API. Deliberately carries no tax-category bucket — that's tax-
 * authority-specific (KRA's VAT_STANDARD/VAT_ZERO/EXEMPT/VAT_8 etc.), not universal, so main API
 * doesn't compute it; this repo resolves it itself via MappingSuggestionService, same as it
 * already does for tax rates/codes.
 */
export interface MainApiStandardizedItem {
  itemType: MainApiStandardizedItemType;
  status: 'Active' | 'Archived' | 'Unknown';
  unitOfMeasureCode?: string;
  sourceSystem: SourceSystem;
}

export interface MainApiStandardizedParty {
  status: 'Active' | 'Archived' | 'Unknown';
  addresses: MainApiStandardizedAddress[];
  sourceSystem: SourceSystem;
}

/** No tax-category bucket here either — see MainApiStandardizedItem's doc comment. */
export interface MainApiStandardizedTax {
  sourceSystem: SourceSystem;
}

export interface MainApiStandardizedInvoice {
  sourceSystem: SourceSystem;
}

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
  /** QuickBooks QtyOnHand, captured on item pull/sync. Undefined for non-inventory items. */
  qtyOnHand?: number | null;
  /** ERP-normalized (not KRA-categorized) itemType from main API's standardization layer — null if this row's source ERP isn't supported by it yet. See standardized-item.mapper.ts, the sole consumer. */
  standardized: MainApiStandardizedItem | null;
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
  /** Pre-resolved provenance from main API's standardization layer — null if this row's source ERP isn't supported by it yet. Optional (unlike MainApiItem's) since nothing in this repo constructs/consumes it yet — kept `| null`-typed rather than fully required so existing fixtures/call sites aren't forced to supply it. */
  standardized?: MainApiStandardizedInvoice | null;
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
  /** Pre-resolved taxCategory from main API's standardization layer — null if this row's source ERP isn't supported by it yet. Optional (unlike MainApiItem's) since pullTaxRates still uses the raw name/effectiveTaxRate heuristic via MappingSuggestionService rather than this field — kept `| null`-typed rather than fully required so existing fixtures/call sites aren't forced to supply it. */
  standardized?: MainApiStandardizedTax | null;
}

export interface MainApiTaxRateListResponse {
  taxRates: MainApiTaxRate[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** QuickBooks' PaymentMethod list entity, as returned by nest-sync-2-books-api's live QuickBooks read. */
export interface MainApiPaymentMethod {
  id: string;
  name: string;
  type?: string | null;
  active?: boolean;
}

export interface MainApiPaymentMethodListResponse {
  paymentMethods: MainApiPaymentMethod[];
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
  /** Pre-resolved taxCategory from main API's standardization layer — null if this row's source ERP isn't supported by it yet. Optional (unlike MainApiItem's) since pullTaxCodes still uses the raw name heuristic via MappingSuggestionService rather than this field — kept `| null`-typed rather than fully required so existing fixtures/call sites aren't forced to supply it. */
  standardized?: MainApiStandardizedTax | null;
}

export interface MainApiTaxCodeListResponse {
  taxCodes: MainApiTaxCode[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Shapes for /suppliers and /customers. MainApiSupplier is consumed by
 * DashboardSuppliersApplicationService.pullSuppliers (see
 * MainApiPullClient.getSuppliers's doc comment); MainApiCustomer's pull
 * flow is the customer-side twin. Confirmed against nest-sync-2-books-api's
 * own list-response DTOs: src/supplier/application/dtos/supplier-list-response.dto.ts
 * and src/customer/application/dtos/customer-list-response.dto.ts.
 */
export interface MainApiSupplier {
  id: string;
  supplierName?: string | null;
  contactName?: string | null;
  emailAddress?: string | null;
  phone?: string | null;
  taxNumber?: string | null;
  bookType?: string | null;
  /**
   * The *ERP's own* supplier id (QuickBooks Vendor Id / Odoo `res.partner` id) — distinct from
   * `id` above, which is main API's own record id. Required when building `CreateBillDto.supplierRef.id`
   * for a bill push (see `MainApiPullClient.createBill`'s doc comment) — `id` alone is not
   * accepted by the ERP.
   */
  bookId?: string | null;
  /** Pre-resolved provenance/address data from main API's standardization layer — null if this row's source ERP isn't supported by it yet. Optional (unlike MainApiItem's) since nothing in this repo constructs/consumes it yet — see getSuppliers' doc comment — kept `| null`-typed rather than fully required so existing fixtures/call sites aren't forced to supply it. */
  standardized?: MainApiStandardizedParty | null;
}

export interface MainApiSupplierListResponse {
  suppliers: MainApiSupplier[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Request body for `MainApiPullClient.createBill` — mirrors nest-sync-2-books-api's `CreateBillDto` (`src/bill/application/dtos/create-bill.dto.ts`), trimmed to the fields this repo actually populates. */
export interface MainApiCreateBillLineItem {
  description?: string;
  unitAmount: number;
  quantity: number;
  subTotal?: number;
  taxAmount?: number;
  totalAmount?: number;
  /** Required by CreateBillDto's line-item schema; a KRA purchase confirmation always represents a direct cost. */
  isDirectCost: boolean;
}

export interface MainApiCreateBillRequest {
  reference?: string;
  supplierRef: { id: string; supplierName?: string };
  issueDate: string;
  currency: string;
  subTotal: number;
  taxAmount: number;
  totalAmount: number;
  lineItems: MainApiCreateBillLineItem[];
  note?: string;
  status: 'Open';
}

export interface MainApiCreateBillResponse {
  bill: {
    id: string;
    billCode?: string;
    bookId?: string;
    syncStatus?: 'pending' | 'syncing' | 'synced' | 'failed';
    syncError?: string;
    [key: string]: unknown;
  };
  message: string;
  syncBatchId: string;
  /**
   * Reflects the real outcome when `createBill` was called with `awaitSync: true` (the default
   * here) — `bill.syncStatus`/`bill.syncError` carry the same information. Only stays `false` as
   * a "not completed yet" placeholder when `awaitSync: false` was explicitly requested.
   */
  syncedToBookkeeping: boolean;
}

export interface MainApiCustomer {
  id: string;
  name: string;
  companyName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  taxId?: string | null;
  bookType?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Pre-resolved provenance/address data from main API's standardization layer — null if this row's source ERP isn't supported by it yet. Optional (unlike MainApiItem's) since nothing in this repo constructs/consumes it yet — see getCustomers' doc comment — kept `| null`-typed rather than fully required so existing fixtures/call sites aren't forced to supply it. */
  standardized?: MainApiStandardizedParty | null;
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
    params: {
      page?: number;
      limit?: number;
      startDate?: string;
      endDate?: string;
    } = {},
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
   * GET /payment-methods/connection/:connectionId — QuickBooks' own
   * PaymentMethod catalog entity (Cash, Check, Credit Card, ...), live-read
   * by the main API rather than served from a local sync table (see that
   * route's doc comment in nest-sync-2-books-api's payment-method.controller.ts
   * for why). Backs Track D's Mapping Center payment-method pull.
   */
  async getPaymentMethods(
    apiKey: string,
    connectionId: string,
  ): Promise<MainApiPaymentMethodListResponse> {
    return this.get<MainApiPaymentMethodListResponse>(
      apiKey,
      `/payment-methods/connection/${encodeURIComponent(connectionId)}`,
      {},
    );
  }

  /**
   * GET /suppliers?connectionId=... — used by
   * DashboardSuppliersApplicationService.pullSuppliers to populate the
   * dashboard's local supplier list from a connected ERP.
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
   * POST /bills/:connectionId — pushes a purchase as a vendor Bill (Accounts Payable). Always a
   * Bill, never a one-step "paid" object — see PURCHASE_TO_ERP_SYNC_PLAN.md's decision for why.
   *
   * Requests `awaitSync=true` by default: main API then blocks until the ERP write actually
   * completes and returns the real `bill.syncStatus`/`bill.syncError`, instead of the
   * fire-and-forget default where `syncedToBookkeeping` is always `false` and unusable as a
   * completion signal. `syncToErp()` (the sole caller today) relies on this — it already awaits
   * each purchase sequentially in a loop, so this adds no real latency, it just makes the
   * existing wait observable. Pass `awaitSync: false` to opt back into fire-and-forget if a
   * future bulk/background caller needs it.
   */
  async createBill(
    apiKey: string,
    connectionId: string,
    body: MainApiCreateBillRequest,
    options: { awaitSync?: boolean } = {},
  ): Promise<MainApiCreateBillResponse> {
    const awaitSync = options.awaitSync ?? true;
    return this.postJson<MainApiCreateBillResponse>(
      apiKey,
      `/bills/${connectionId}?awaitSync=${awaitSync}`,
      body,
    );
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
   * Which integrations (quickbooks/odoo/etc.) are enabled for the Application
   * behind this apiKey, per its Connectors settings on the main API — lets
   * the ERP Connection page only offer integrations an admin actually turned
   * on there, instead of always offering every integration this repo knows
   * how to render a card for.
   */
  async getEnabledIntegrationKeys(apiKey: string): Promise<string[]> {
    const body = await this.get<{ integrationKeys: string[] }>(
      apiKey,
      '/integrations/enabled',
      {},
    );
    return body.integrationKeys ?? [];
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

  /** Sibling to syncCustomersFromBookkeeping -- see supplier.controller.ts's identical route on the main API. */
  async syncSuppliersFromBookkeeping(
    apiKey: string,
    connectionId: string,
  ): Promise<unknown> {
    return this.post(
      apiKey,
      `/suppliers/connection/${connectionId}/sync-from-bookkeeping`,
    );
  }

  /**
   * Tax rates/codes use a different main-API route shape than the other
   * sync-from-bookkeeping endpoints (POST /tax-rates/sync/:connectionId, not
   * .../connection/:connectionId/sync-from-bookkeeping) -- confirmed against
   * tax-rate.controller.ts/tax-code.controller.ts. Without calling these
   * first, main API's own tax_rates/tax_codes tables stay empty for any
   * connection that was never explicitly synced, so getTaxRates()/
   * getTaxCodes() below silently return nothing even when the ERP itself
   * has real tax data -- confirmed live against a QuickBooks connection
   * that had 18 real tax rates but had never once been synced.
   */
  async syncTaxRatesFromBookkeeping(
    apiKey: string,
    connectionId: string,
  ): Promise<unknown> {
    return this.post(apiKey, `/tax-rates/sync/${connectionId}`);
  }

  async syncTaxCodesFromBookkeeping(
    apiKey: string,
    connectionId: string,
  ): Promise<unknown> {
    return this.post(apiKey, `/tax-codes/sync/${connectionId}`);
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

  // --- Generic sync-item status/retry (dashboard receipt-attachment proxy) ---
  // Backs DashboardInvoicesController's receipt-attachment-status/
  // retry-receipt-attachment routes. Auth'd the same way as every other call
  // in this client (x-api-key against the tenant's stored Main-API
  // connection), NOT the internal bearer-token scheme Sync2BooksMainApiOscuClient
  // uses for the invoice-receipt webhook — these are Main API's normal
  // external API surface, entity-type-agnostic.

  /**
   * GET /sync/items/:syncItemId — generic single-sync-item status lookup.
   * UNCONFIRMED PATH: at the time this was written, Main API's exact route
   * for this (entity-type-agnostic single-item status) was still being
   * finalized in a parallel task; this is a best guess based on the
   * confirmed retry route below. Verify against Main API's actual route
   * before relying on this in production.
   */
  async getSyncItemStatus(
    apiKey: string,
    syncItemId: string,
  ): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(
      apiKey,
      `/sync/items/${syncItemId}`,
      {},
    );
  }

  /**
   * POST /sync/items/:syncItemId/retry — confirmed generic retry route,
   * entity-type-agnostic, needs only the sync item id.
   */
  async retrySyncItem(
    apiKey: string,
    syncItemId: string,
  ): Promise<Record<string, unknown>> {
    return this.post<Record<string, unknown>>(
      apiKey,
      `/sync/items/${syncItemId}/retry`,
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
