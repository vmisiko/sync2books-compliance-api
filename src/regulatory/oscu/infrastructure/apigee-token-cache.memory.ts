import type { IApigeeTokenCache } from '../ports/apigee-token-cache.port';

/**
 * Single-process token cache with in-flight deduplication (no Redis).
 */
export class InMemoryApigeeTokenCache implements IApigeeTokenCache {
  private readonly store = new Map<
    string,
    { value: string; expiresAtMs: number }
  >();
  private readonly inFlight = new Map<string, Promise<string>>();

  async getOrSet(
    key: string,
    factory: () => Promise<{ value: string; ttlSeconds: number }>,
  ): Promise<string> {
    const existing = this.store.get(key);
    if (existing && existing.expiresAtMs > Date.now()) {
      return existing.value;
    }

    let p = this.inFlight.get(key);
    if (!p) {
      p = (async () => {
        const again = this.store.get(key);
        if (again && again.expiresAtMs > Date.now()) {
          return again.value;
        }
        const { value, ttlSeconds } = await factory();
        const expiresAtMs = Date.now() + Math.max(1, ttlSeconds) * 1000;
        this.store.set(key, { value, expiresAtMs });
        return value;
      })().finally(() => {
        this.inFlight.delete(key);
      });
      this.inFlight.set(key, p);
    }
    return p;
  }
}
