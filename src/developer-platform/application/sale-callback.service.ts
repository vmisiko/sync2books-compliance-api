import { lookup } from 'node:dns/promises';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SalesService } from '../../sales/application/sales.service';
import type { ComplianceDocument } from '../../sales/domain/entities/compliance-document.entity';
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import { SALE_CALLBACK_STORE } from '../../shared/tokens';
import {
  allowPrivateCallbackUrls,
  callbackUrlProblem,
  isPrivateAddress,
} from '../domain/callback-url';
import {
  nextCallbackAttemptAt,
  type SaleCallback,
  type SaleCallbackEvent,
} from '../domain/sale-callback';
import { toV1Sale } from '../presentation/v1/v1-views';
import type { ISaleCallbackStore } from './ports/sale-callback.store.port';

/** How long one POST may take before it counts as a failed attempt. */
const REQUEST_TIMEOUT_MS = 10_000;
/** How long a claimed delivery is hidden from other workers. */
const CLAIM_LEASE_MS = 2 * 60_000;
const SWEEP_BATCH = 50;

type AttemptResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
};

/**
 * Tells a `/v1` caller the eTIMS result of a sale by POSTing it to the
 * `callbackUrl` they sent with the sale -- DigiTax's callback model.
 *
 * Fires on every result the sale reaches (KRA accepted, KRA rejected, failed),
 * however it got there: the original request, `POST /v1/sales/:id/retry`, or a
 * retry from the dashboard. The body is the same `sale` object
 * `GET /v1/sales/:id` returns. Delivery happens off the request path; a
 * non-2xx answer, a timeout or a network error is retried with backoff by the
 * per-minute sweep, and the outcome of each attempt is kept on the record so
 * the caller can see whether they were told.
 */
@Injectable()
export class SaleCallbackService implements OnModuleInit {
  private readonly logger = new Logger(SaleCallbackService.name);
  private sweeping = false;

  /** Seams for specs. */
  resolveHost = async (host: string): Promise<string[]> =>
    (await lookup(host, { all: true })).map((a) => a.address);
  now = (): Date => new Date();

  constructor(
    @Inject(SALE_CALLBACK_STORE)
    private readonly store: ISaleCallbackStore,
    private readonly sales: SalesService,
  ) {}

  onModuleInit(): void {
    this.sales.onOutcome((document) => this.recordOutcome(document));
  }

  /** Remember where to send this sale's result. Call before submitting it. */
  async register(
    documentId: string,
    merchantId: string,
    url: string,
  ): Promise<void> {
    const now = this.now();
    await this.store.save({
      documentId,
      merchantId,
      url,
      status: 'awaiting_outcome',
      event: null,
      outcomeKey: null,
      payload: null,
      attempts: 0,
      nextAttemptAt: null,
      lastAttemptAt: null,
      lastResponseStatus: null,
      lastError: null,
      deliveredAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  findForDocument(documentId: string): Promise<SaleCallback | null> {
    return this.store.findByDocumentId(documentId);
  }

  /**
   * A sale reached a result. Snapshot the sale as the caller will receive it
   * and queue delivery; the same result announced twice is queued once.
   */
  async recordOutcome(document: ComplianceDocument): Promise<void> {
    const event = outcomeEvent(document.complianceStatus);
    if (!event) return;

    const callback = await this.store.findByDocumentId(document.id);
    // The merchant check is belt-and-braces: the record is written by the
    // request that created this document, under the same merchant.
    if (!callback || callback.merchantId !== document.merchantId) return;

    const outcomeKey = `${document.complianceStatus}:${document.submissionAttempts}`;
    if (callback.outcomeKey === outcomeKey) return;

    const sale = toV1Sale(
      await this.sales.getNormalizedSaleReport(document.id),
    );
    const now = this.now();
    await this.store.save({
      ...callback,
      status: 'pending',
      event,
      outcomeKey,
      payload: {
        id: `${document.id}:${outcomeKey}`,
        event,
        occurredAt: now.toISOString(),
        data: { sale },
      },
      attempts: 0,
      nextAttemptAt: now,
      lastAttemptAt: null,
      lastResponseStatus: null,
      lastError: null,
      deliveredAt: null,
    });

    // Off the request path: a slow or dead receiver must not hold up the
    // response to the sale itself.
    setImmediate(() => {
      void this.deliver(document.id, outcomeKey).catch((err: unknown) =>
        this.logger.error(
          `callback document=${document.id} delivery crashed: ${errorMessage(err)}`,
        ),
      );
    });
  }

  /**
   * Make one delivery attempt for `outcomeKey`, if it is still pending and due
   * and no other worker holds it.
   */
  async deliver(documentId: string, outcomeKey: string): Promise<void> {
    const startedAt = this.now();
    const claimed = await this.store.claim(
      documentId,
      outcomeKey,
      startedAt,
      new Date(startedAt.getTime() + CLAIM_LEASE_MS),
    );
    if (!claimed) return;

    const callback = await this.store.findByDocumentId(documentId);
    if (!callback || callback.outcomeKey !== outcomeKey) return;

    const attempts = callback.attempts + 1;
    const result = await this.post(callback, attempts);
    const finishedAt = this.now();

    if (result.ok) {
      await this.store.save({
        ...callback,
        status: 'delivered',
        attempts,
        nextAttemptAt: null,
        lastAttemptAt: finishedAt,
        lastResponseStatus: result.status,
        lastError: null,
        deliveredAt: finishedAt,
      });
      this.logger.log(
        `callback document=${documentId} event=${callback.event} delivered attempt=${attempts} status=${result.status}`,
      );
      return;
    }

    const nextAttemptAt = nextCallbackAttemptAt(attempts, finishedAt);
    await this.store.save({
      ...callback,
      status: nextAttemptAt ? 'pending' : 'failed',
      attempts,
      nextAttemptAt,
      lastAttemptAt: finishedAt,
      lastResponseStatus: result.status,
      lastError: result.error?.slice(0, 500) ?? null,
    });
    this.logger.warn(
      `callback document=${documentId} event=${callback.event} attempt=${attempts} failed: ${result.error}` +
        (nextAttemptAt
          ? ` -- retrying at ${nextAttemptAt.toISOString()}`
          : ' -- giving up'),
    );
  }

  /**
   * Deliver the latest result again from a clean slate -- for a caller whose
   * endpoint was down long enough to exhaust the retries. Attempts once, now,
   * so the response can say how it went.
   */
  async resend(documentId: string): Promise<SaleCallback | null> {
    const callback = await this.store.findByDocumentId(documentId);
    if (!callback?.outcomeKey) return callback;
    await this.store.save({
      ...callback,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: this.now(),
      deliveredAt: null,
    });
    await this.deliver(documentId, callback.outcomeKey);
    return this.store.findByDocumentId(documentId);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const due = await this.store.findDue(this.now(), SWEEP_BATCH);
      for (const callback of due) {
        if (!callback.outcomeKey) continue;
        try {
          await this.deliver(callback.documentId, callback.outcomeKey);
        } catch (err) {
          this.logger.error(
            `callback document=${callback.documentId} sweep delivery crashed: ${errorMessage(err)}`,
          );
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  private async post(
    callback: SaleCallback,
    attempt: number,
  ): Promise<AttemptResult> {
    // Re-checked at send time: the rules may have tightened since the sale
    // was created, and a stored URL is not trusted just because it is stored.
    const problem = callbackUrlProblem(callback.url);
    if (problem) {
      return { ok: false, status: null, error: `callbackUrl ${problem}` };
    }

    const url = new URL(callback.url);
    if (!allowPrivateCallbackUrls()) {
      let addresses: string[];
      try {
        addresses = await this.resolveHost(
          url.hostname.replace(/^\[|\]$/g, ''),
        );
      } catch (err) {
        return {
          ok: false,
          status: null,
          error: `Could not resolve ${url.hostname}: ${errorMessage(err)}`,
        };
      }
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
        return {
          ok: false,
          status: null,
          error: `${url.hostname} does not resolve to a public address`,
        };
      }
    }

    try {
      const response = await fetch(callback.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Sync2Books-Compliance-Callbacks/1.0',
          'X-Callback-Id': `${callback.documentId}:${callback.outcomeKey}`,
          'X-Callback-Event': callback.event ?? '',
          'X-Callback-Attempt': String(attempt),
        },
        body: JSON.stringify(callback.payload),
        // A redirect could send the request somewhere the checks above never
        // saw; a 3xx counts as a failed attempt instead.
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 200 && response.status < 300) {
        return { ok: true, status: response.status, error: null };
      }
      return {
        ok: false,
        status: response.status,
        error: `Endpoint answered HTTP ${response.status}`,
      };
    } catch (err) {
      const timedOut =
        err instanceof Error &&
        (err.name === 'TimeoutError' || err.name === 'AbortError');
      return {
        ok: false,
        status: null,
        error: timedOut
          ? `No response within ${REQUEST_TIMEOUT_MS / 1000}s`
          : errorMessage(err),
      };
    }
  }
}

function outcomeEvent(status: ComplianceStatus): SaleCallbackEvent | null {
  switch (status) {
    case ComplianceStatus.ACCEPTED:
      return 'sale.completed';
    case ComplianceStatus.REJECTED:
    case ComplianceStatus.FAILED:
      return 'sale.failed';
    default:
      return null;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error
      ? `${err.message}: ${cause.message}`
      : err.message;
  }
  return String(err);
}
