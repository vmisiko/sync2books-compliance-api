/**
 * Parsed from Main API Pattern 2 headers (inbound to Compliance).
 */
export type Sync2BooksCorrelation = {
  syncItemId: string;
  syncBatchId: string;
  companyId: string;
  applicationId?: string;
  connectionId?: string;
};

/**
 * Stored on entities as JSON for retries.
 */
export type Sync2BooksCorrelationStored = Sync2BooksCorrelation;
