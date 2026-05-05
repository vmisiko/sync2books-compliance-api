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
}
