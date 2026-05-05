import type { Request } from 'express';
import type { Sync2BooksCorrelation } from './sync2books-correlation.types';

export const SYNC2BOOKS_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readHttpHeader(req: Request, name: string): string | undefined {
  const h = req?.headers;
  if (!h || typeof h !== 'object') {
    return undefined;
  }
  const raw = h[name.toLowerCase()];
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t.length ? t : undefined;
  }
  if (Array.isArray(raw)) {
    const t = raw[0]?.trim();
    return t?.length ? t : undefined;
  }
  return undefined;
}

export function parseSync2BooksCorrelation(
  req: Request,
): Sync2BooksCorrelation | null {
  const syncItemId = readHttpHeader(req, 'x-sync2books-sync-item-id');
  const syncBatchId = readHttpHeader(req, 'x-sync2books-sync-batch-id');
  const companyId = readHttpHeader(req, 'x-sync2books-company-id');
  if (!syncItemId || !syncBatchId || !companyId) {
    return null;
  }
  for (const v of [syncItemId, syncBatchId, companyId]) {
    if (!SYNC2BOOKS_UUID_RE.test(v)) {
      return null;
    }
  }
  const applicationId = readHttpHeader(req, 'x-sync2books-application-id');
  const connectionId = readHttpHeader(req, 'x-sync2books-connection-id');
  if (applicationId && !SYNC2BOOKS_UUID_RE.test(applicationId)) {
    return null;
  }
  if (connectionId && !SYNC2BOOKS_UUID_RE.test(connectionId)) {
    return null;
  }
  return {
    syncItemId,
    syncBatchId,
    companyId,
    ...(applicationId ? { applicationId } : {}),
    ...(connectionId ? { connectionId } : {}),
  };
}
