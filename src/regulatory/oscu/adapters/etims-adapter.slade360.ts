import type {
  EtimsConnectionContext,
  EtimsSubmissionResult,
  IEtimsAdapter,
} from '../ports/etims-adapter.port';
import type { OscuEnvelopeResponse } from '../transport/oscu-envelope-result';
import type {
  EtimsInvoiceLine,
  EtimsInvoicePayload,
} from '../mapping/etims-payload.types';
import { round2 } from '../mapping/oscu-tax-rates';
import type {
  OscuItemSaveReq,
  OscuItemSaveRes,
} from '../transport/endpoints/item-save.dto';
import type {
  OscuStockIOSaveReq,
  OscuStockIOSaveRes,
} from '../transport/endpoints/stock-io-save.dto';
import type {
  OscuStockMasterSaveReq,
  OscuStockMasterSaveRes,
} from '../transport/endpoints/stock-master-save.dto';
import type {
  OscuStockMoveReq,
  OscuStockMoveRes,
} from '../transport/endpoints/stock-move-list.dto';
import type { IApigeeTokenCache } from '../ports/apigee-token-cache.port';
import {
  fetchSlade360AccessToken,
  resolveSlade360AccessTokenExpiresAtMs,
} from '../transport/slade360-client-credentials';
import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';

/**
 * Resource paths confirmed live against real Slade360 docs pages
 * (docs.slade360.com/etims-api/branches, /etims-api/sales#sign-sales-invoice,
 * /etims-api/sales#sign-credit-note, /etims-api/item#create-an-item-product).
 */
const CONFIRMED_PATHS = {
  // Trailing slashes are required, not stylistic — confirmed live 2026-08-23:
  // the backend is Django/DRF with APPEND_SLASH, so a request without one gets
  // a 301 to the slash-appended URL. `fetch` follows redirects by default, but
  // a POST redirected through a 301 risks the body being dropped by the
  // redirect (pre-HTTP/1.1 301 semantics) — confirmed via curl that hitting
  // these paths without a slash returns a fast 301 rather than reaching the
  // real handler, so this isn't optional.
  fetchOrganisationBranches:
    '/api/branches/branches/fetch_etims_organisation_branches/',
  syncBranchToEtims: '/api/branches/branches/sync_to_etims/',
  createProduct: '/api/products/products/',
  signSalesInvoice: '/api/etims/sign_sales_invoice/',
  signSalesCreditNote: '/api/etims/sign_sales_credit_note/',
} as const;

export type EtimsAdapterSlade360Config = {
  /** Dev default per Slade360's docs; pass the prod host for production. */
  authBaseUrl?: string;
  /** Dev default per Slade360's docs; pass the prod host for production. */
  apiBaseUrl?: string;
  clientId: string;
  clientSecret: string;
  /**
   * Fallback `X-Workstation` value when `EtimsConnectionContext.workstationId`
   * is unset. Slade360 describes this as a per-user/session concept, not a
   * branch id — a single static default is a stopgap, not the end state.
   */
  defaultWorkstationId?: string;
  timeoutMs?: number;
  tokenRefreshBufferMs?: number;
  tokenCache?: IApigeeTokenCache;
  /** Override a confirmed default path (see `CONFIRMED_PATHS`) — escape hatch only. */
  saveItemPath?: string;
  signInvoiceDirectlyPath?: string;
  signCreditNoteDirectlyPath?: string;
};

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return String(value);
  return '';
}

function nowYyyyMMddhhmmss(): string {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`
  );
}

/**
 * Slade360 doesn't share KRA OSCU's `responseHeader`/`resultCd` envelope
 * (confirmed via the schema reference — see architecture plan §4), so there's
 * no fixed field to read a rejection reason from. Best-effort across the
 * common REST-framework shapes (DRF-style `detail`, generic `message`/`error`).
 */
function describeHttpRejection(
  status: number,
  raw: Record<string, unknown>,
): string {
  const detail =
    safeString(raw['detail']) ||
    safeString(raw['message']) ||
    safeString(raw['error']);
  return detail
    ? `HTTP ${status} calling Slade360: ${detail}`
    : `HTTP ${status} calling Slade360: ${JSON.stringify(raw).slice(0, 300)}`;
}

/**
 * Confirmed against the real API reference (docs.slade360.com/etims-api/sales):
 * both `sign_sales_invoice` and `sign_sales_credit_note` document "No data
 * returned" on their 200 response — so this will almost always resolve to
 * `undefined` on a real call, and that's expected, not a bug. Left in place
 * defensively (some deployments do echo an id/number despite the docs saying
 * otherwise) rather than deleted, but callers should not rely on getting a
 * receipt number back from this call. If Sync2Books needs the actual CU
 * invoice number / KRA verification code / QR code, that likely means a
 * follow-up lookup call (or the granular create→lines→transition→sign flow's
 * `GET .../download`, confirmed via the "Create an eTIMS Invoice" guide) —
 * not something the "directly" convenience endpoints hand back synchronously.
 */
function extractSlade360ReceiptNumber(
  raw: Record<string, unknown>,
): string | undefined {
  const candidates = [
    'cu_invoice_number',
    'cuInvoiceNumber',
    'invoice_number',
    'receipt_number',
    'curRcptNo',
    'id',
  ];
  for (const key of candidates) {
    const v = raw[key];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/**
 * Slade360's branch-list response has no confirmed field-level schema (their
 * own docs give only a bare "fetched successfully" message, not a structured
 * example) — so rather than guess a field name like `kra_bhf_id` and risk a
 * false negative, this walks the whole response looking for `needle` as a
 * string value anywhere in it. A false positive here would be worse than a
 * false negative (it would let a genuinely unonboarded branch "go live"), so
 * this only returns true on an exact, case-insensitive string match — no
 * fuzzy matching.
 */
function containsStringValueDeep(
  value: unknown,
  needle: string,
  depth = 0,
): boolean {
  if (depth > 6) return false;
  if (typeof value === 'string') {
    return value.trim().toLowerCase() === needle.trim().toLowerCase();
  }
  if (Array.isArray(value)) {
    return value.some((v) => containsStringValueDeep(v, needle, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) =>
      containsStringValueDeep(v, needle, depth + 1),
    );
  }
  return false;
}

/** `AddbusinessitemproductRequest` (docs.slade360.com/etims-api/~schemas). */
function mapItemToSlade360Product(
  req: OscuItemSaveReq,
): Record<string, unknown> {
  const classification = Number.parseInt(req.itemClsCd, 10);
  return {
    name: req.itemNm,
    // Schema types this as an int; OSCU's itemClsCd is a code string. Falls
    // back to the raw string if it isn't numeric rather than silently zeroing it.
    scu_item_classification: Number.isFinite(classification)
      ? classification
      : req.itemClsCd,
    selling_price: String(req.dftPrc),
    // OSCU's item-save request has no distinct cost/purchase-price field —
    // defaults to the selling price until a real source is wired in.
    purchasing_price: String(req.dftPrc),
    sale_taxes: [req.taxTyCd],
    purchase_taxes: [req.taxTyCd],
    identifiers: req.bcd
      ? [{ identifier_type: 'barcode', identifier_value: req.bcd }]
      : [],
    product_type: req.itemTyCd,
    item_type: req.itemTyCd,
    categories: [],
    packaging_unit: req.pkgUnitCd,
    quantity_unit: req.qtyUnitCd,
    country_of_origin: req.orgnNatCd,
  };
}

/** `SignSalesInvoiceDirectlyRequest` (docs.slade360.com/etims-api/~schemas). */
function mapInvoiceToSlade360SignDirectly(
  payload: EtimsInvoicePayload,
): Record<string, unknown> {
  return {
    reference_number: payload.documentNumber,
    customer_pin: payload.customerPin ?? '',
    partner_name: payload.customerName ?? '',
    // OSCU has no direct cash/credit distinction on the payload this adapter
    // receives — defaults to cash until real invoices are tested against sandbox.
    sales_type: 'cash',
    customer_reference: payload.documentNumber,
    itemDetails: payload.lines.map(mapLineToSlade360ItemDetail),
  };
}

function mapLineToSlade360ItemDetail(
  line: EtimsInvoiceLine,
): Record<string, unknown> {
  return {
    product_name: line.description,
    unit_price: line.unitPrice,
    discount: 0,
    quantity: line.quantity,
    uom: line.unitCode,
    tax_code: line.taxTyCd,
  };
}

/**
 * `SignCreditNotesDirectlyRequest` (docs.slade360.com/etims-api/~schemas) —
 * a thin shape with no per-item `tax_code`, unlike the invoice request. See
 * architecture plan §8 "Credit note tax context" for the implication.
 */
function mapCreditNoteToSlade360SignDirectly(
  payload: EtimsInvoicePayload,
): Record<string, unknown> {
  return {
    invoice_reference: payload.originalDocumentNumber ?? '',
    refund_reason: payload.creditNoteReasonCode ?? 'CUSTOMER_RETURN',
    amount: payload.totalAmount,
    items: payload.lines.map((l) => ({
      item_name: l.description,
      quantity: l.quantity,
      amount: round2(l.quantity * l.unitPrice),
    })),
  };
}

/**
 * eTIMS/OSCU adapter that routes through Slade360's REST API instead of KRA's
 * OSCU directly, while returning the exact shapes `IEtimsAdapter` callers
 * already expect. See the architecture plan (eTIMS Provider Swap) for the
 * design decisions this encodes:
 *
 * - `initializeOscu` makes no real device-init call — Slade360 automates VSCU
 *   deployment on their side rather than exposing it as an API. But this is
 *   the one place in the codebase that gates a connection going ACTIVE
 *   (`initializeEtimsConnection` in compliance-organization.application.service.ts),
 *   so it isn't a blind no-op either: it calls `fetch_etims_organisation_branches`
 *   and confirms the branch is actually present before reporting success —
 *   a business/branch that hasn't been onboarded on Slade360's own platform
 *   (their self-serve wizard or integration team) cannot go live on this connection.
 * - `submitInvoice`, `saveItem`, `branchList`, and `branchSendCustomerInfo` are
 *   wired to real, confirmed endpoints (paths verified against
 *   docs.slade360.com/etims-api/sales and /etims-api/item, not guessed).
 *   Note `sign_sales_invoice` / `sign_sales_credit_note` both document "No
 *   data returned" on success — no CU invoice number/QR code comes back
 *   synchronously from these calls, see `extractSlade360ReceiptNumber`.
 * - Everything else returns a clear "not implemented" result rather than a
 *   guessed endpoint — stock in particular needs real remodeling (Slade360
 *   uses workflow documents, not a flat call), and the remaining lookups
 *   didn't have confirmed schemas at the time this was written.
 */
export class EtimsAdapterSlade360 implements IEtimsAdapter {
  private readonly logger = new Logger(EtimsAdapterSlade360.name);
  private readonly authBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly defaultWorkstationId: string | undefined;
  private readonly timeoutMs: number;
  private readonly tokenRefreshBufferMs: number;
  private readonly tokenCache: IApigeeTokenCache | undefined;
  private readonly saveItemPath: string;
  private readonly signInvoiceDirectlyPath: string;
  private readonly signCreditNoteDirectlyPath: string;

  constructor(config: EtimsAdapterSlade360Config) {
    this.authBaseUrl = (
      config.authBaseUrl ?? 'https://identity-dev.slade360edi.com'
    ).replace(/\/$/, '');
    this.apiBaseUrl = (
      config.apiBaseUrl ?? 'https://api-dev.slade360edi.com/erp'
    ).replace(/\/$/, '');
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.defaultWorkstationId = config.defaultWorkstationId;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.tokenRefreshBufferMs = config.tokenRefreshBufferMs ?? 120_000;
    this.tokenCache = config.tokenCache;
    this.saveItemPath = config.saveItemPath ?? CONFIRMED_PATHS.createProduct;
    this.signInvoiceDirectlyPath =
      config.signInvoiceDirectlyPath ?? CONFIRMED_PATHS.signSalesInvoice;
    this.signCreditNoteDirectlyPath =
      config.signCreditNoteDirectlyPath ?? CONFIRMED_PATHS.signSalesCreditNote;
  }

  private tokenCacheKey(): string {
    return createHash('sha256')
      .update(`${this.authBaseUrl}|${this.clientId}`)
      .digest('hex')
      .slice(0, 40);
  }

  private async resolveBearerToken(): Promise<string> {
    const fetchToken = () =>
      fetchSlade360AccessToken({
        authBaseUrl: this.authBaseUrl,
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        timeoutMs: this.timeoutMs,
      });

    if (!this.tokenCache) {
      const { accessToken } = await fetchToken();
      return accessToken;
    }

    return this.tokenCache.getOrSet(this.tokenCacheKey(), async () => {
      const { accessToken, raw } = await fetchToken();
      const expiresAtMs = resolveSlade360AccessTokenExpiresAtMs(raw);
      const ttlSec = Math.max(
        1,
        Math.floor(
          (expiresAtMs - Date.now() - this.tokenRefreshBufferMs) / 1000,
        ),
      );
      return { value: accessToken, ttlSeconds: ttlSec };
    });
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> | undefined,
    ctx: EtimsConnectionContext,
  ): Promise<{ ok: boolean; status: number; raw: Record<string, unknown> }> {
    const url = joinUrl(this.apiBaseUrl, path);
    const token = await this.resolveBearerToken();
    const workstation = ctx.workstationId ?? this.defaultWorkstationId;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (workstation) headers['X-Workstation'] = workstation;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const logCtx = `${method} ${path} merchant=${ctx.merchantId} branch=${ctx.branchId} env=${ctx.environment}`;
    this.logger.debug(
      `-> ${logCtx}${body !== undefined ? ` body=${JSON.stringify(body)}` : ''}`,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      const json = text ? (JSON.parse(text) as unknown) : null;
      const raw = asRecord(json) ?? {};

      if (!res.ok) {
        this.logger.warn(
          `<- ${logCtx} status=${res.status} rejected: ${JSON.stringify(raw)}`,
        );
      } else {
        this.logger.debug(`<- ${logCtx} status=${res.status} ok`);
      }
      return { ok: res.ok, status: res.status, raw };
    } catch (e) {
      const cause =
        e instanceof Error
          ? (e as Error & { cause?: unknown }).cause
          : undefined;
      this.logger.error(
        `x ${logCtx} threw: ${e instanceof Error ? e.message : safeString(e)}` +
          (cause ? ` cause=${safeString(cause) || JSON.stringify(cause)}` : ''),
      );
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  private notImplementedEnvelope(
    method: string,
    reason: string,
  ): Promise<OscuEnvelopeResponse> {
    const error = `Slade360 adapter: ${method} not implemented — ${reason}`;
    this.logger.warn(error);
    return Promise.resolve({ success: false, error });
  }

  // ---- submitInvoice (real call — SignSalesInvoiceDirectlyRequest / SignCreditNotesDirectlyRequest) ----

  async submitInvoice(
    payload: EtimsInvoicePayload,
    ctx: EtimsConnectionContext,
  ): Promise<EtimsSubmissionResult> {
    const isCreditNote =
      (payload.documentType ?? '').toUpperCase() === 'CREDIT_NOTE';
    try {
      return isCreditNote
        ? await this.signCreditNoteDirectly(payload, ctx)
        : await this.signInvoiceDirectly(payload, ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : safeString(e);
      const retryable =
        msg.includes('aborted') ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('fetch');
      return { success: false, error: retryable ? `retryable: ${msg}` : msg };
    }
  }

  private async signInvoiceDirectly(
    payload: EtimsInvoicePayload,
    ctx: EtimsConnectionContext,
  ): Promise<EtimsSubmissionResult> {
    const request = mapInvoiceToSlade360SignDirectly(payload);
    const { ok, status, raw } = await this.request(
      'POST',
      this.signInvoiceDirectlyPath,
      request,
      ctx,
    );
    if (!ok) {
      return {
        success: false,
        error: describeHttpRejection(status, raw),
        rawResponse: { request, response: raw },
      };
    }
    return {
      success: true,
      receiptNumber: extractSlade360ReceiptNumber(raw),
      rawResponse: { request, response: raw },
    };
  }

  private async signCreditNoteDirectly(
    payload: EtimsInvoicePayload,
    ctx: EtimsConnectionContext,
  ): Promise<EtimsSubmissionResult> {
    const request = mapCreditNoteToSlade360SignDirectly(payload);
    const { ok, status, raw } = await this.request(
      'POST',
      this.signCreditNoteDirectlyPath,
      request,
      ctx,
    );
    if (!ok) {
      return {
        success: false,
        error: describeHttpRejection(status, raw),
        rawResponse: { request, response: raw },
      };
    }
    return {
      success: true,
      receiptNumber: extractSlade360ReceiptNumber(raw),
      rawResponse: { request, response: raw },
    };
  }

  // ---- saveItem (real call — AddbusinessitemproductRequest) ----

  async saveItem(
    request: OscuItemSaveReq,
    ctx: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuItemSaveRes;
    error?: string;
  }> {
    const body = mapItemToSlade360Product(request);
    try {
      const { ok, status, raw } = await this.request(
        'POST',
        this.saveItemPath,
        body,
        ctx,
      );
      const resultDt = nowYyyyMMddhhmmss();
      if (!ok) {
        const error = describeHttpRejection(status, raw);
        return {
          success: false,
          error,
          rawResponse: {
            resultCd: String(status),
            resultMsg: error,
            resultDt,
            data: null,
          },
        };
      }
      return {
        success: true,
        rawResponse: {
          resultCd: '000',
          resultMsg: 'It is succeeded',
          resultDt,
          data: null,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : safeString(e);
      return { success: false, error: msg };
    }
  }

  // ---- initializeOscu: no real device-init call (Slade360 automates VSCU
  // deployment on their side), but this is the one place in the codebase that
  // gates a connection going ACTIVE (see `initializeEtimsConnection` in
  // compliance-organization.application.service.ts) — so it still has to do
  // real work: confirm the branch actually exists on Slade360's platform
  // before reporting success, rather than rubber-stamping every request. ----

  async initializeOscu(
    body: Record<string, unknown>,
    ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    const tin = typeof body.tin === 'string' ? body.tin : '';
    const bhfId = typeof body.bhfId === 'string' ? body.bhfId : '';
    const dvcSrlNo = typeof body.dvcSrlNo === 'string' ? body.dvcSrlNo : '';

    if (!bhfId) {
      return {
        success: false,
        error:
          'Slade360 adapter: cannot verify go-live readiness without a bhfId to check for',
      };
    }

    try {
      const { ok, status, raw } = await this.request(
        'GET',
        CONFIRMED_PATHS.fetchOrganisationBranches,
        undefined,
        ctx,
      );
      if (!ok) {
        return {
          success: false,
          error: `Slade360 branch verification failed (cannot confirm the business/branch is onboarded on Slade360): ${describeHttpRejection(status, raw)}`,
          rawResponse: raw,
        };
      }
      if (!containsStringValueDeep(raw, bhfId)) {
        return {
          success: false,
          error:
            `Branch "${bhfId}" was not found in Slade360's organisation branch list. ` +
            'The business/branch must be onboarded on Slade360 first — via their ' +
            'self-serve wizard (dev.advantage.slade360.com/auth/welcome) or their ' +
            'integration team — before this connection can go live on the Slade360 provider.',
          rawResponse: raw,
        };
      }

      return {
        success: true,
        rawResponse: {
          resultCd: '000',
          resultMsg: `Confirmed branch "${bhfId}" is onboarded on Slade360 — no separate device-init call made (Slade360 automates VSCU deployment)`,
          resultDt: nowYyyyMMddhhmmss(),
          data: {
            info: {
              tin,
              bhfId,
              dvcSrlNo,
              dvcId: `slade360-managed-${bhfId}`,
              cmcKey: 'slade360-managed',
            },
          },
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : safeString(e);
      return {
        success: false,
        error: `Slade360 branch verification threw: ${msg}`,
      };
    }
  }

  // ---- branch endpoints (real calls — confirmed paths) ----

  async branchList(
    _body: Record<string, unknown>,
    ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    void _body;
    const { ok, status, raw } = await this.request(
      'GET',
      CONFIRMED_PATHS.fetchOrganisationBranches,
      undefined,
      ctx,
    );
    if (!ok)
      return {
        success: false,
        error: describeHttpRejection(status, raw),
        rawResponse: raw,
      };
    return { success: true, rawResponse: raw };
  }

  async branchSendCustomerInfo(
    body: Record<string, unknown>,
    ctx: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    const userId =
      typeof body.user_id === 'string'
        ? body.user_id
        : typeof body.userId === 'string'
          ? body.userId
          : '';
    if (!userId) {
      return {
        success: false,
        error: 'Slade360 branchSendCustomerInfo requires body.user_id (a UUID)',
      };
    }
    const path = `${CONFIRMED_PATHS.syncBranchToEtims}?user_id=${encodeURIComponent(userId)}`;
    const { ok, status, raw } = await this.request('POST', path, {}, ctx);
    if (!ok)
      return {
        success: false,
        error: describeHttpRejection(status, raw),
        rawResponse: raw,
      };
    return { success: true, rawResponse: raw };
  }

  // ---- typed stock methods: not implemented — Slade360 models stock as a
  // workflow document, not a flat call; needs remodeling, not just field mapping ----

  insertStockIO(
    _request: OscuStockIOSaveReq,
    _ctx: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockIOSaveRes;
    error?: string;
  }> {
    void _request;
    void _ctx;
    const error =
      'Slade360 adapter: insertStockIO not implemented — Slade360 models stock as a workflow document (inventory transfer with lines/workflow_state), not a flat call; needs remodeling, see architecture plan §8';
    this.logger.warn(error);
    return Promise.resolve({ success: false, error });
  }

  saveStockMaster(
    _request: OscuStockMasterSaveReq,
    _ctx: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockMasterSaveRes;
    error?: string;
  }> {
    void _request;
    void _ctx;
    const error =
      'Slade360 adapter: saveStockMaster not implemented — same stock-model mismatch as insertStockIO, see architecture plan §8';
    this.logger.warn(error);
    return Promise.resolve({ success: false, error });
  }

  selectStockMoveList(
    _request: OscuStockMoveReq,
    _ctx: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockMoveRes;
    error?: string;
  }> {
    void _request;
    void _ctx;
    const error =
      'Slade360 adapter: selectStockMoveList not implemented — same stock-model mismatch as insertStockIO, see architecture plan §8';
    this.logger.warn(error);
    return Promise.resolve({ success: false, error });
  }

  // ---- everything else: schema/path not confirmed at the time this was written ----

  branchInsuranceInfo(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'branchInsuranceInfo',
      'no confirmed Slade360 equivalent found in docs pulled for this plan',
    );
  }

  branchUserAccount(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'branchUserAccount',
      'no confirmed Slade360 equivalent found in docs pulled for this plan',
    );
  }

  selectCodeList(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'selectCodeList',
      'no confirmed Slade360 equivalent found in docs pulled for this plan',
    );
  }

  customerPinInfo(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'customerPinInfo',
      'customer schemas were found but not a confirmed request path — see architecture plan §7',
    );
  }

  selectCustomerList(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'selectCustomerList',
      'customer schemas were found but not a confirmed request path — see architecture plan §7',
    );
  }

  selectItemClsList(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'selectItemClsList',
      'no confirmed Slade360 equivalent found in docs pulled for this plan',
    );
  }

  selectTaxpayerInfo(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'selectTaxpayerInfo',
      'no confirmed Slade360 equivalent found in docs pulled for this plan',
    );
  }

  selectNoticeList(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'selectNoticeList',
      'schema found (Notice/Getetimsnoticesexampleresponse) but not a confirmed request path — see architecture plan §7',
    );
  }

  importedItemInfo(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'importedItemInfo',
      'schema found (Result6, paginated) but not a confirmed request path — see architecture plan §7',
    );
  }

  importedItemConvertedInfo(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'importedItemConvertedInfo',
      'no confirmed Slade360 equivalent found in docs pulled for this plan',
    );
  }

  getItemInfo(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'getItemInfo',
      'no confirmed Slade360 equivalent found in docs pulled for this plan',
    );
  }

  saveItemComposition(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'saveItemComposition',
      'no confirmed Slade360 equivalent found in docs pulled for this plan',
    );
  }

  getPurchaseTransactionInfo(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'getPurchaseTransactionInfo',
      "not wired into Sync2Books' own OSCU path today either — low priority, see architecture plan §7",
    );
  }

  sendPurchaseTransactionInfo(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'sendPurchaseTransactionInfo',
      "not wired into Sync2Books' own OSCU path today either — low priority, see architecture plan §7",
    );
  }

  selectInvoiceDetail(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'selectInvoiceDetail',
      'no confirmed Slade360 equivalent found in docs pulled for this plan',
    );
  }

  selectSalesTransactions(): Promise<OscuEnvelopeResponse> {
    return this.notImplementedEnvelope(
      'selectSalesTransactions',
      'no confirmed Slade360 equivalent found in docs pulled for this plan',
    );
  }
}
