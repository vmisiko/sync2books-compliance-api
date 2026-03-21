/**
 * Shared Apigee OAuth access-token cache (Redis in production, in-memory for tests).
 */
export interface IApigeeTokenCache {
  /**
   * Returns a cached token or runs `factory` once (per key), with concurrency
   * deduplication and optional distributed locking (Redis).
   */
  getOrSet(
    key: string,
    factory: () => Promise<{ value: string; ttlSeconds: number }>,
  ): Promise<string>;
}
