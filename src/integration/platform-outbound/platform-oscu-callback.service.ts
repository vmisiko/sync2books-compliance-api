import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { parseSync2BooksCorrelation } from './sync2books-request-headers.util';
import type { Sync2BooksCorrelation } from './sync2books-correlation.types';
import {
  Sync2BooksMainApiOscuClient,
  type Sync2BooksOscuOutcomeBody,
} from './sync2books-main-api-oscu.client';

@Injectable()
export class PlatformOscuCallbackService {
  constructor(private readonly mainApi: Sync2BooksMainApiOscuClient) {}

  /**
   * Merge Pattern 2 correlation from the request with outcome fields and POST to Main.
   */
  async postOutcomeFromRequest(
    req: Request,
    outcome: Omit<
      Sync2BooksOscuOutcomeBody,
      'syncItemId' | 'syncBatchId' | 'companyId'
    > &
      Partial<
        Pick<Sync2BooksOscuOutcomeBody, 'applicationId' | 'connectionId'>
      >,
  ): Promise<void> {
    const correlation = parseSync2BooksCorrelation(req);
    if (!correlation) {
      return;
    }
    await this.postOutcomeWithCorrelation(correlation, outcome);
  }

  /**
   * POST using correlation loaded from a persisted entity (retries).
   */
  async postOutcomeWithCorrelation(
    correlation: Sync2BooksCorrelation,
    outcome: Omit<
      Sync2BooksOscuOutcomeBody,
      'syncItemId' | 'syncBatchId' | 'companyId'
    > &
      Partial<
        Pick<Sync2BooksOscuOutcomeBody, 'applicationId' | 'connectionId'>
      >,
  ): Promise<void> {
    await this.mainApi.postOscuOutcome({
      ...outcome,
      syncItemId: correlation.syncItemId,
      syncBatchId: correlation.syncBatchId,
      companyId: correlation.companyId,
      applicationId: outcome.applicationId ?? correlation.applicationId,
      connectionId: outcome.connectionId ?? correlation.connectionId,
    });
  }

  /**
   * Stock flows: terminal success callback on the active sync item.
   */
  async emitStockOutcome(
    req: Request,
    channel: 'STOCK_TRANSFER' | 'STOCK_ADJUST',
    raw: Record<string, unknown>,
  ): Promise<void> {
    const correlation = parseSync2BooksCorrelation(req);
    if (!correlation) {
      return;
    }
    await this.mainApi.postOscuOutcome({
      syncItemId: correlation.syncItemId,
      syncBatchId: correlation.syncBatchId,
      companyId: correlation.companyId,
      applicationId: correlation.applicationId,
      connectionId: correlation.connectionId,
      channel,
      aggregateStatus: 'SUCCESS',
      complianceStatus: 'ACCEPTED',
      oscuPhase: 'FINAL',
      eventId: randomUUID(),
      raw: { channel, ...raw },
    });
  }
}
