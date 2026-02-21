import type {
  EtimsSubmissionResult,
  IEtimsAdapter,
} from '../ports/etims-adapter.port';
import type { EtimsInvoicePayload } from '../mapping/etims-payload.types';
import { OscuSalesRequestBuilder } from '../mapping/oscu-sales-request.builder';
import type { OscuTrnsSalesSaveWrRes } from '../transport/endpoints/trns-sales-save.dto';

type EtimsAdapterHttpConfig = {
  sandboxBaseUrl?: string;
  productionBaseUrl?: string;
  timeoutMs?: number;
};

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
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

export class EtimsAdapterHttp implements IEtimsAdapter {
  private readonly sandboxBaseUrl: string;
  private readonly productionBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(config?: EtimsAdapterHttpConfig) {
    // OSCU spec v2.0 environment base URLs
    this.sandboxBaseUrl =
      config?.sandboxBaseUrl ?? 'https://etims-api-sbx.kra.go.ke/etims-api';
    this.productionBaseUrl =
      config?.productionBaseUrl ?? 'https://etims-api.kra.go.ke/etims-api';
    this.timeoutMs = config?.timeoutMs ?? 30_000;
  }

  async submitInvoice(
    payload: EtimsInvoicePayload,
    connectionContext: {
      merchantId: string;
      branchId: string;
      kraPin: string;
      environment: 'SANDBOX' | 'PRODUCTION';
      cmcKey: string;
      deviceId: string;
    },
  ): Promise<EtimsSubmissionResult> {
    const request = OscuSalesRequestBuilder.build({
      payload,
      tin: connectionContext.kraPin,
      bhfId: connectionContext.branchId,
      cmcKey: connectionContext.cmcKey,
    });

    const baseUrl =
      connectionContext.environment === 'PRODUCTION'
        ? this.productionBaseUrl
        : this.sandboxBaseUrl;

    const url = joinUrl(baseUrl, '/saveTrnsSalesOsdc');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      const text = await res.text();
      const json: unknown = text ? JSON.parse(text) : null;
      const rawResponse: Record<string, unknown> = asRecord(json) ?? {};

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

      if (!res.ok) {
        const retryable = isRetryableStatus(res.status);
        return {
          success: false,
          error: retryable
            ? `retryable: HTTP ${res.status} calling OSCU`
            : `HTTP ${res.status} calling OSCU`,
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

      // Non-success result codes: treat as rejection unless explicitly retryable.
      const retryable = resultCd.startsWith('9'); // conservative: keep 9xx as transient/system
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
    } finally {
      clearTimeout(timeout);
    }
  }
}
