import { Injectable, Logger } from '@nestjs/common';

/**
 * Body shape accepted by Main API `POST /internal/compliance/oscu-outcome`.
 * Mirrors `api/src/compliance/dto/compliance-oscu-outcome.dto.ts`.
 */
export type Sync2BooksOscuOutcomeBody = {
  syncItemId: string;
  syncBatchId: string;
  companyId: string;
  applicationId?: string;
  connectionId?: string;
  channel?: string;
  complianceDocumentId?: string;
  /**
   * Main-API `Invoice` id this document originated from (see
   * `ComplianceDocument.sourceInvoiceId`), when the sale was created from a
   * pulled ERP invoice. Lets Main API link the callback back to its own
   * `Invoice` row without needing full Pattern 2 sync-item correlation.
   */
  sourceInvoiceId?: string | null;
  aggregateStatus?: 'SUCCESS' | 'FAILED' | 'PARTIAL' | 'INFO';
  complianceStatus?: string;
  oscuPhase?: string;
  receiptNumber?: string | null;
  error?: string | null;
  raw?: Record<string, unknown>;
  catalogItemResults?: Array<{
    catalogItemId: string;
    success?: boolean;
    resultCd?: string | null;
    resultMsg?: string | null;
  }>;
  eventId?: string;
};

/**
 * Request body accepted by Main API `POST /internal/compliance/invoice-receipt`
 * — the new, unconditional counterpart to `oscu-outcome` above. Unlike
 * `oscu-outcome`, this doesn't require a pre-existing sync_item/Pattern-2
 * correlation: Main API creates the sync_item itself and hands back its id.
 */
export type Sync2BooksInvoiceReceiptBody = {
  sourceInvoiceId: string;
  companyId: string;
  applicationId: string;
  complianceDocumentId: string;
  receiptNumber?: string;
};

export type Sync2BooksInvoiceReceiptResult = {
  syncItemId: string;
  syncBatchId: string;
  status: string;
};

/**
 * Synchronous POST to Main's /internal/compliance/oscu-outcome (Pattern 2 headers + JSON body).
 */
@Injectable()
export class Sync2BooksMainApiOscuClient {
  private readonly logger = new Logger(Sync2BooksMainApiOscuClient.name);

  async postOscuOutcome(body: Sync2BooksOscuOutcomeBody): Promise<void> {
    const mainBaseUrl = process.env.MAIN_API_BASE_URL?.trim();
    if (!mainBaseUrl) {
      this.logger.warn(
        'MAIN_API_BASE_URL unset — skipping POST /internal/compliance/oscu-outcome',
      );
      return;
    }

    const base = mainBaseUrl.replace(/\/?$/, '');
    const url = `${base}/internal/compliance/oscu-outcome`;

    const token =
      typeof process.env.COMPLIANCE_CALLBACK_TOKEN === 'string'
        ? process.env.COMPLIANCE_CALLBACK_TOKEN.trim()
        : '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-sync2books-company-id': body.companyId,
      'x-sync2books-sync-item-id': body.syncItemId,
      'x-sync2books-sync-batch-id': body.syncBatchId,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      this.logger.warn(
        'COMPLIANCE_CALLBACK_TOKEN unset — Main API may reject oscu-outcome in non-local environments',
      );
    }
    if (body.applicationId) {
      headers['x-sync2books-application-id'] = body.applicationId;
    }
    if (body.connectionId) {
      headers['x-sync2books-connection-id'] = body.connectionId;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `oscu-outcome failed: ${res.status} ${res.statusText} ${text.slice(0, 500)}`,
      );
      throw new Error(
        `Main API oscu-outcome failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
  }

  /**
   * Unconditional notification for the pulled-invoice-sale flow (Mode B
   * dashboard) — POSTs to Main's new `/internal/compliance/invoice-receipt`
   * route, which needs only bearer-token auth + the company-id header (same
   * `ComplianceCallbackAuthGuard` mechanism as oscu-outcome above), no
   * correlation headers or pre-existing sync_item. Main API creates the
   * sync_item/sync_batch and returns their ids so we can store them on the
   * `ComplianceDocument` for later status lookup/retry.
   */
  async postInvoiceReceipt(
    body: Sync2BooksInvoiceReceiptBody,
  ): Promise<Sync2BooksInvoiceReceiptResult> {
    const mainBaseUrl = process.env.MAIN_API_BASE_URL?.trim();
    if (!mainBaseUrl) {
      throw new Error(
        'MAIN_API_BASE_URL unset — cannot POST /internal/compliance/invoice-receipt',
      );
    }

    const base = mainBaseUrl.replace(/\/?$/, '');
    const url = `${base}/internal/compliance/invoice-receipt`;

    const token =
      typeof process.env.COMPLIANCE_CALLBACK_TOKEN === 'string'
        ? process.env.COMPLIANCE_CALLBACK_TOKEN.trim()
        : '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-sync2books-company-id': body.companyId,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      this.logger.warn(
        'COMPLIANCE_CALLBACK_TOKEN unset — Main API may reject invoice-receipt in non-local environments',
      );
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `invoice-receipt failed: ${res.status} ${res.statusText} ${text.slice(0, 500)}`,
      );
      throw new Error(
        `Main API invoice-receipt failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }

    return res.json() as Promise<Sync2BooksInvoiceReceiptResult>;
  }
}
