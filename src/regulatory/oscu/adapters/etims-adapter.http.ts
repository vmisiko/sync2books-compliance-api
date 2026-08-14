import type {
  EtimsConnectionContext,
  EtimsSubmissionResult,
  IEtimsAdapter,
} from '../ports/etims-adapter.port';
import type { EtimsInvoicePayload } from '../mapping/etims-payload.types';
import { OscuSalesRequestBuilder } from '../mapping/oscu-sales-request.builder';
import type { OscuTrnsSalesSaveWrRes } from '../transport/endpoints/trns-sales-save.dto';
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
import type {
  OscuEndpointKey,
  OscuPathStyle,
} from '../transport/oscu-endpoints';
import { resolveOscuPath } from '../transport/oscu-endpoints';
import type { OscuEnvelopeResponse } from '../transport/oscu-envelope-result';
import type { OscuRequestContext } from '../transport/oscu-api.types';
import type { IApigeeTokenCache } from '../ports/apigee-token-cache.port';
import {
  fetchEtimsApigeeAccessToken,
  resolveApigeeAccessTokenExpiresAtMs,
  type FetchEtimsApigeeAccessTokenParams,
  type FetchEtimsApigeeAccessTokenResult,
} from '../transport/apigee-client-credentials';
import { createHash } from 'crypto';
import { Logger } from '@nestjs/common';

type EtimsAdapterHttpConfig = {
  sandboxBaseUrl?: string;
  productionBaseUrl?: string;
  timeoutMs?: number;
  /** `legacy` = OSCU spec v2.0 paths; `integrator` = Apigee eTIMS-OSCU Postman collection. */
  pathStyle?: OscuPathStyle;
  /** Fallback when `connectionContext.apigeeAppId` is unset (integrator). */
  defaultApigeeAppId?: string;
  /** Static bearer (skips client-credentials + cache). */
  defaultBearerAccessToken?: string;
  /** Client credentials for token URL (used with `apigeeTokenCache`). */
  apigeeClientId?: string;
  apigeeClientSecret?: string;
  /** Host for `GET /v1/token/generate` (no path). */
  apigeeTokenBaseUrlSandbox?: string;
  apigeeTokenBaseUrlProduction?: string;
  /**
   * Refresh this many ms before computed expiry when setting Redis TTL.
   * @default 120_000
   */
  tokenRefreshBufferMs?: number;
  /** Redis (or in-memory) cache for OAuth access tokens. */
  apigeeTokenCache?: IApigeeTokenCache;
};

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * On a non-2xx HTTP response, `postOscu()`'s `raw` is the whole parsed body
 * (since `responseBody` is null), which for Apigee integrator errors looks
 * like `{ responseHeader: { responseCode, customerMessage, debugMessage }, responseBody: null }`.
 * Without this, every HTTP-level rejection collapsed into an undiagnosable
 * "HTTP 400 calling OSCU" -- confirmed live 2026-08-11 debugging insertStockIO,
 * where the real cause ("Incorrect Quantity Unit Code...") was sitting right
 * there in the response body the whole time.
 */
function describeHttpRejection(status: number, raw: Record<string, unknown>): string {
  const header = asRecord(raw['responseHeader']);
  const detail =
    (header && safeString(header['debugMessage'])) ||
    (header && safeString(header['customerMessage'])) ||
    '';
  return detail ? `HTTP ${status} calling OSCU: ${detail}` : `HTTP ${status} calling OSCU`;
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

function asJsonBody<T extends OscuRequestContext>(
  pathStyle: OscuPathStyle,
  req: T,
): Record<string, unknown> {
  if (pathStyle === 'integrator') {
    const { tin, bhfId, cmcKey, ...rest } = req;
    void tin;
    void bhfId;
    void cmcKey;
    return rest as Record<string, unknown>;
  }
  return req as unknown as Record<string, unknown>;
}

export class EtimsAdapterHttp implements IEtimsAdapter {
  private readonly logger = new Logger(EtimsAdapterHttp.name);
  private readonly sandboxBaseUrl: string;
  private readonly productionBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly pathStyle: OscuPathStyle;
  private readonly defaultApigeeAppId: string | undefined;
  private readonly defaultBearerAccessToken: string | undefined;
  private readonly apigeeClientId: string | undefined;
  private readonly apigeeClientSecret: string | undefined;
  private readonly apigeeTokenBaseUrlSandbox: string | undefined;
  private readonly apigeeTokenBaseUrlProduction: string | undefined;
  private readonly tokenRefreshBufferMs: number;
  private readonly apigeeTokenCache: IApigeeTokenCache | undefined;

  constructor(config?: EtimsAdapterHttpConfig) {
    this.sandboxBaseUrl =
      config?.sandboxBaseUrl ?? 'https://etims-api-sbx.kra.go.ke/etims-api';
    this.productionBaseUrl =
      config?.productionBaseUrl ?? 'https://etims-api.kra.go.ke/etims-api';
    this.timeoutMs = config?.timeoutMs ?? 30_000;
    this.pathStyle = config?.pathStyle ?? 'legacy';
    this.defaultApigeeAppId = config?.defaultApigeeAppId;
    this.defaultBearerAccessToken = config?.defaultBearerAccessToken;
    this.apigeeClientId = config?.apigeeClientId;
    this.apigeeClientSecret = config?.apigeeClientSecret;
    this.apigeeTokenBaseUrlSandbox = config?.apigeeTokenBaseUrlSandbox;
    this.apigeeTokenBaseUrlProduction = config?.apigeeTokenBaseUrlProduction;
    this.tokenRefreshBufferMs = config?.tokenRefreshBufferMs ?? 120_000;
    this.apigeeTokenCache = config?.apigeeTokenCache;
  }

  async fetchEtimsApigeeAccessToken(
    params: FetchEtimsApigeeAccessTokenParams,
  ): Promise<FetchEtimsApigeeAccessTokenResult> {
    return fetchEtimsApigeeAccessToken(params);
  }

  private resolveApigeeTokenBaseUrl(
    environment: 'SANDBOX' | 'PRODUCTION',
  ): string {
    if (environment === 'PRODUCTION') {
      return this.apigeeTokenBaseUrlProduction ?? 'https://kra.go.ke';
    }
    return this.apigeeTokenBaseUrlSandbox ?? 'https://sbx.kra.go.ke';
  }

  private apigeeTokenCacheKey(environment: 'SANDBOX' | 'PRODUCTION'): string {
    const base = this.resolveApigeeTokenBaseUrl(environment);
    const id = this.apigeeClientId ?? '';
    return createHash('sha256')
      .update(`${base}|${id}|${environment}`)
      .digest('hex')
      .slice(0, 40);
  }

  private async resolveBearerToken(
    ctx: EtimsConnectionContext,
  ): Promise<string | undefined> {
    if (ctx.bearerAccessToken) return ctx.bearerAccessToken;
    if (this.defaultBearerAccessToken) return this.defaultBearerAccessToken;
    if (this.pathStyle !== 'integrator') return undefined;
    if (
      !this.apigeeClientId ||
      !this.apigeeClientSecret ||
      !this.apigeeTokenCache
    ) {
      return undefined;
    }

    const tokenBase = this.resolveApigeeTokenBaseUrl(ctx.environment);
    const cacheKey = this.apigeeTokenCacheKey(ctx.environment);

    return this.apigeeTokenCache.getOrSet(cacheKey, async () => {
      const { accessToken, raw } = await fetchEtimsApigeeAccessToken({
        tokenBaseUrl: tokenBase,
        clientId: this.apigeeClientId!,
        clientSecret: this.apigeeClientSecret!,
        timeoutMs: this.timeoutMs,
      });
      const expiresAtMs = resolveApigeeAccessTokenExpiresAtMs(raw, accessToken);
      const ttlSec = Math.max(
        1,
        Math.floor(
          (expiresAtMs - Date.now() - this.tokenRefreshBufferMs) / 1000,
        ),
      );
      return { value: accessToken, ttlSeconds: ttlSec };
    });
  }

  private async buildHeaders(
    ctx: EtimsConnectionContext,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.pathStyle === 'integrator') {
      headers.tin = ctx.kraPin;
      headers.bhfId = ctx.branchId;
      headers.cmcKey = ctx.cmcKey;
      const appId = ctx.apigeeAppId ?? this.defaultApigeeAppId;
      if (appId) headers['apigee_app_id'] = appId;
      const token = await this.resolveBearerToken(ctx);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  private resolveBaseUrl(environment: 'SANDBOX' | 'PRODUCTION'): string {
    return environment === 'PRODUCTION'
      ? this.productionBaseUrl
      : this.sandboxBaseUrl;
  }

  /**
   * Single choke point every OSCU call goes through (both the generic
   * `postOscuEnvelope` dispatch and the bespoke typed methods like
   * `insertStockIO`). Centralizing request/response/error logging here means
   * it's always on -- we spent a lot of this project debugging KRA sandbox
   * errors ("Please try again later" on insertStockIO, ENETDOWN vs real
   * rejection) by hand-adding `console.error` and reverting it afterward.
   * That's a sign the logging belongs here permanently, not in the caller.
   */
  private async postOscu(
    pathSegment: string,
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<{ ok: boolean; status: number; raw: Record<string, unknown> }> {
    const url = joinUrl(
      this.resolveBaseUrl(connectionContext.environment),
      pathSegment,
    );
    const logCtx = `${pathSegment} merchant=${connectionContext.merchantId} branch=${connectionContext.branchId} env=${connectionContext.environment}`;
    const headers = await this.buildHeaders(connectionContext);

    this.logger.debug(`-> ${logCtx} body=${JSON.stringify(body)}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      const json = text ? (JSON.parse(text) as unknown) : null;
      const parsed = asRecord(json) ?? {};
      const responseBodyRaw = parsed['responseBody'];
      // Apigee integrator gateway wraps the OSCU business payload as
      // { responseHeader, responseBody: { resultCd, resultMsg, resultDt, data } }.
      // Legacy/direct KRA responses are already flat -- unwrap here, once, so every
      // caller of postOscu() sees a consistent flat shape regardless of gateway style.
      const raw = asRecord(responseBodyRaw) ?? parsed;

      // The gateway sometimes wraps a genuine business rejection
      // (responseHeader.responseCode != 200/201) inside an OUTER HTTP 200 with
      // responseBody: null -- confirmed live 2026-08-12 on saveStockMaster
      // ("rsdQty mismatch..." sitting in responseHeader.debugMessage, silently
      // treated as success because res.ok was true). Detect it explicitly rather
      // than trusting the outer HTTP status alone.
      const header = asRecord(parsed['responseHeader']);
      const envelopeResponseCode = header?.['responseCode'];
      const envelopeIndicatesFailure =
        responseBodyRaw === null &&
        typeof envelopeResponseCode === 'number' &&
        envelopeResponseCode >= 300;

      const resultCd = safeString(raw['resultCd']);
      const isBusinessFailure = resultCd !== '' && resultCd !== '000';
      const ok = res.ok && !envelopeIndicatesFailure;
      const status = envelopeIndicatesFailure
        ? (envelopeResponseCode as number)
        : res.status;

      if (!ok || isBusinessFailure) {
        this.logger.warn(
          `<- ${logCtx} status=${status} rejected: ${JSON.stringify(raw)}`,
        );
      } else {
        this.logger.debug(`<- ${logCtx} status=${status} ok`);
      }

      return { ok, status, raw };
    } catch (e) {
      // `.cause` is what actually disambiguates a real KRA rejection from local
      // sandbox network flakiness (e.g. ENETDOWN surfaces as a generic "fetch
      // failed" without it) -- confirmed live 2026-08-11/12. Log it every time
      // instead of re-adding this inspection by hand next time something looks flaky.
      const cause = e instanceof Error ? (e as Error & { cause?: unknown }).cause : undefined;
      this.logger.error(
        `x ${logCtx} threw: ${e instanceof Error ? e.message : safeString(e)}` +
          (cause ? ` cause=${safeString(cause) || JSON.stringify(cause)}` : ''),
      );
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postOscuEnvelope(
    endpointKey: OscuEndpointKey,
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    const path = resolveOscuPath(this.pathStyle, endpointKey);
    try {
      const { ok, status, raw } = await this.postOscu(
        path,
        body,
        connectionContext,
      );
      const rawResponse: Record<string, unknown> = { ...raw };
      const resultCd = safeString(raw['resultCd']);
      const resultMsg = safeString(raw['resultMsg']);

      if (!ok) {
        const retryable = isRetryableStatus(status);
        return {
          success: false,
          error: retryable
            ? `retryable: ${describeHttpRejection(status, raw)}`
            : describeHttpRejection(status, raw),
          rawResponse,
        };
      }

      if (resultCd === '000') {
        return { success: true, rawResponse };
      }

      const retryable = resultCd.startsWith('9');
      return {
        success: false,
        error: retryable
          ? `retryable: OSCU ${resultCd} ${resultMsg}`.trim()
          : `OSCU ${resultCd} ${resultMsg}`.trim(),
        rawResponse,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : safeString(e);
      const retryable =
        msg.includes('aborted') ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('fetch');
      return {
        success: false,
        error: retryable ? `retryable: ${msg}` : msg,
      };
    }
  }

  async submitInvoice(
    payload: EtimsInvoicePayload,
    connectionContext: EtimsConnectionContext,
  ): Promise<EtimsSubmissionResult> {
    const request = OscuSalesRequestBuilder.build({
      payload,
      tin: connectionContext.kraPin,
      bhfId: connectionContext.branchId,
      cmcKey: connectionContext.cmcKey,
    });

    const path = resolveOscuPath(this.pathStyle, 'submitSales');
    const body = asJsonBody(this.pathStyle, request);

    try {
      const { ok, status, raw } = await this.postOscu(
        path,
        body,
        connectionContext,
      );
      const rawResponse: Record<string, unknown> = raw;

      const envelope = rawResponse as Partial<OscuTrnsSalesSaveWrRes>;
      const resultCd = safeString(envelope.resultCd);
      const resultMsg = safeString(envelope.resultMsg);

      const dataRaw = asRecord(envelope.data);
      const curRcptNo = safeString(
        dataRaw?.curRcptNo ?? dataRaw?.['curRcptNo '],
      );

      const responseSnapshot: Record<string, unknown> = {
        ...rawResponse,
        request,
      };

      if (!ok) {
        const retryable = isRetryableStatus(status);
        return {
          success: false,
          error: retryable
            ? `retryable: ${describeHttpRejection(status, raw)}`
            : describeHttpRejection(status, raw),
          rawResponse: responseSnapshot,
        };
      }

      if (resultCd === '000') {
        return {
          success: true,
          receiptNumber: curRcptNo || undefined,
          rawResponse: responseSnapshot,
        };
      }

      const retryable = resultCd.startsWith('9');
      return {
        success: false,
        error: retryable
          ? `retryable: OSCU ${resultCd} ${resultMsg}`.trim()
          : `OSCU ${resultCd} ${resultMsg}`.trim(),
        rawResponse: responseSnapshot,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : safeString(e);
      const retryable =
        msg.includes('aborted') ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('fetch');
      return {
        success: false,
        error: retryable ? `retryable: ${msg}` : msg,
        rawResponse: { request },
      };
    }
  }

  async saveItem(
    request: OscuItemSaveReq,
    connectionContext: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuItemSaveRes;
    error?: string;
  }> {
    const path = resolveOscuPath(this.pathStyle, 'saveItem');
    const body = asJsonBody(this.pathStyle, request);
    try {
      const { ok, status, raw } = await this.postOscu(
        path,
        body,
        connectionContext,
      );
      const rawResponse: OscuItemSaveRes = {
        resultCd: safeString(raw['resultCd']),
        resultMsg: safeString(raw['resultMsg']),
        resultDt: safeString(raw['resultDt']),
        data: null,
      };
      const resultCd = rawResponse.resultCd;
      const resultMsg = rawResponse.resultMsg;

      if (!ok) {
        const retryable = isRetryableStatus(status);
        return {
          success: false,
          error: retryable
            ? `retryable: ${describeHttpRejection(status, raw)}`
            : describeHttpRejection(status, raw),
          rawResponse,
        };
      }

      if (resultCd === '000') {
        return {
          success: true,
          rawResponse,
        };
      }

      const retryable = resultCd.startsWith('9');
      return {
        success: false,
        error: retryable
          ? `retryable: OSCU ${resultCd} ${resultMsg}`.trim()
          : `OSCU ${resultCd} ${resultMsg}`.trim(),
        rawResponse,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : safeString(e);
      const retryable =
        msg.includes('aborted') ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('fetch');
      return { success: false, error: retryable ? `retryable: ${msg}` : msg };
    }
  }

  async insertStockIO(
    request: OscuStockIOSaveReq,
    connectionContext: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockIOSaveRes;
    error?: string;
  }> {
    const path = resolveOscuPath(this.pathStyle, 'insertStockIO');
    const body = asJsonBody(this.pathStyle, request);
    try {
      const { ok, status, raw } = await this.postOscu(
        path,
        body,
        connectionContext,
      );
      const rawResponse: OscuStockIOSaveRes = {
        resultCd: safeString(raw['resultCd']),
        resultMsg: safeString(raw['resultMsg']),
        resultDt: safeString(raw['resultDt']),
        data: null,
      };
      const resultCd = rawResponse.resultCd;
      const resultMsg = rawResponse.resultMsg;

      if (!ok) {
        const retryable = isRetryableStatus(status);
        return {
          success: false,
          error: retryable
            ? `retryable: ${describeHttpRejection(status, raw)}`
            : describeHttpRejection(status, raw),
          rawResponse,
        };
      }

      if (resultCd === '000') {
        return {
          success: true,
          rawResponse,
        };
      }

      const retryable = resultCd.startsWith('9');
      return {
        success: false,
        error: retryable
          ? `retryable: OSCU ${resultCd} ${resultMsg}`.trim()
          : `OSCU ${resultCd} ${resultMsg}`.trim(),
        rawResponse,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : safeString(e);
      const retryable =
        msg.includes('aborted') ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('fetch');
      return { success: false, error: retryable ? `retryable: ${msg}` : msg };
    }
  }

  async saveStockMaster(
    request: OscuStockMasterSaveReq,
    connectionContext: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockMasterSaveRes;
    error?: string;
  }> {
    const path = resolveOscuPath(this.pathStyle, 'saveStockMaster');
    const body = asJsonBody(this.pathStyle, request);
    try {
      const { ok, status, raw } = await this.postOscu(
        path,
        body,
        connectionContext,
      );
      const rawResponse: OscuStockMasterSaveRes = {
        resultCd: safeString(raw['resultCd']),
        resultMsg: safeString(raw['resultMsg']),
        resultDt: safeString(raw['resultDt']),
        data: null,
      };
      const resultCd = rawResponse.resultCd;
      const resultMsg = rawResponse.resultMsg;

      if (!ok) {
        const retryable = isRetryableStatus(status);
        return {
          success: false,
          error: retryable
            ? `retryable: ${describeHttpRejection(status, raw)}`
            : describeHttpRejection(status, raw),
          rawResponse,
        };
      }

      if (resultCd === '000') {
        return {
          success: true,
          rawResponse,
        };
      }

      const retryable = resultCd.startsWith('9');
      return {
        success: false,
        error: retryable
          ? `retryable: OSCU ${resultCd} ${resultMsg}`.trim()
          : `OSCU ${resultCd} ${resultMsg}`.trim(),
        rawResponse,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : safeString(e);
      const retryable =
        msg.includes('aborted') ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('fetch');
      return { success: false, error: retryable ? `retryable: ${msg}` : msg };
    }
  }

  async selectStockMoveList(
    request: OscuStockMoveReq,
    connectionContext: EtimsConnectionContext,
  ): Promise<{
    success: boolean;
    rawResponse?: OscuStockMoveRes;
    error?: string;
  }> {
    const path = resolveOscuPath(this.pathStyle, 'selectStockMoveList');
    // Unlike the write-style endpoints, this lookup rejects a body with tin/bhfId
    // stripped out ("tin cannot be Null") even though they're already in the
    // headers -- confirmed live 2026-08-11. Pass the request through as-is instead
    // of running it through asJsonBody's integrator-style stripping.
    try {
      const { ok, status, raw } = await this.postOscu(
        path,
        { ...request },
        connectionContext,
      );
      const dataRaw = asRecord(raw['data']);
      const stockMoveList = Array.isArray(dataRaw?.stockMoveList)
        ? (dataRaw.stockMoveList.filter((x) => asRecord(x) != null) as Array<
            Record<string, unknown>
          >)
        : undefined;

      const rawResponse: OscuStockMoveRes = {
        resultCd: safeString(raw['resultCd']),
        resultMsg: safeString(raw['resultMsg']),
        resultDt: safeString(raw['resultDt']),
        data: dataRaw ? { stockMoveList } : null,
      };
      const resultCd = rawResponse.resultCd;
      const resultMsg = rawResponse.resultMsg;

      if (!ok) {
        const retryable = isRetryableStatus(status);
        return {
          success: false,
          error: retryable
            ? `retryable: ${describeHttpRejection(status, raw)}`
            : describeHttpRejection(status, raw),
          rawResponse,
        };
      }

      if (resultCd === '000') {
        return {
          success: true,
          rawResponse,
        };
      }

      const retryable = resultCd.startsWith('9');
      return {
        success: false,
        error: retryable
          ? `retryable: OSCU ${resultCd} ${resultMsg}`.trim()
          : `OSCU ${resultCd} ${resultMsg}`.trim(),
        rawResponse,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : safeString(e);
      const retryable =
        msg.includes('aborted') ||
        msg.toLowerCase().includes('timeout') ||
        msg.toLowerCase().includes('fetch');
      return { success: false, error: retryable ? `retryable: ${msg}` : msg };
    }
  }

  branchInsuranceInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope(
      'branchInsuranceInfo',
      body,
      connectionContext,
    );
  }

  branchUserAccount(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope('branchUserAccount', body, connectionContext);
  }

  branchSendCustomerInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope(
      'branchSendCustomerInfo',
      body,
      connectionContext,
    );
  }

  branchList(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope('branchList', body, connectionContext);
  }

  selectCodeList(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope('selectCodeList', body, connectionContext);
  }

  customerPinInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope('customerPinInfo', body, connectionContext);
  }

  selectCustomerList(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope('selectCustomerList', body, connectionContext);
  }

  selectItemClsList(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope('selectItemClsList', body, connectionContext);
  }

  selectTaxpayerInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope('selectTaxpayerInfo', body, connectionContext);
  }

  selectNoticeList(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope('selectNoticeList', body, connectionContext);
  }

  importedItemInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope('importedItemInfo', body, connectionContext);
  }

  importedItemConvertedInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope(
      'importedItemConvertedInfo',
      body,
      connectionContext,
    );
  }

  initializeOscu(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope('initialize', body, connectionContext);
  }

  getItemInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope('itemInfo', body, connectionContext);
  }

  saveItemComposition(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope(
      'saveItemComposition',
      body,
      connectionContext,
    );
  }

  getPurchaseTransactionInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope(
      'getPurchaseTransactionInfo',
      body,
      connectionContext,
    );
  }

  sendPurchaseTransactionInfo(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope(
      'sendPurchaseTransactionInfo',
      body,
      connectionContext,
    );
  }

  selectInvoiceDetail(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope(
      'selectInvoiceDetail',
      body,
      connectionContext,
    );
  }

  selectSalesTransactions(
    body: Record<string, unknown>,
    connectionContext: EtimsConnectionContext,
  ): Promise<OscuEnvelopeResponse> {
    return this.postOscuEnvelope(
      'selectSalesTransactions',
      body,
      connectionContext,
    );
  }
}
