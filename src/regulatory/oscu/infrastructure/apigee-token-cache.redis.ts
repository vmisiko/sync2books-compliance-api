import type { IApigeeTokenCache } from '../ports/apigee-token-cache.port';
import type { RedisLike } from './redis-like';

const LOCK_WAIT_MS = 100;
const LOCK_WAIT_ATTEMPTS = 40;

/**
 * Redis-backed Apigee token cache with SET NX lock so only one instance refreshes.
 */
export class RedisApigeeTokenCache implements IApigeeTokenCache {
  constructor(
    private readonly redis: RedisLike,
    private readonly keyPrefix = 'etims:apigee:access-token',
  ) {}

  private fullKey(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  async getOrSet(
    key: string,
    factory: () => Promise<{ value: string; ttlSeconds: number }>,
  ): Promise<string> {
    const fk = this.fullKey(key);
    const lockKey = `${fk}:lock`;

    const cached = await this.redis.get(fk);
    if (cached) return cached;

    const got = await this.redis.set(lockKey, '1', 'EX', 15, 'NX');
    if (got !== 'OK') {
      for (let i = 0; i < LOCK_WAIT_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, LOCK_WAIT_MS));
        const retry = await this.redis.get(fk);
        if (retry) return retry;
      }
      throw new Error(
        'Redis Apigee token cache: timeout waiting for peer to refresh token',
      );
    }

    try {
      const again = await this.redis.get(fk);
      if (again) return again;
      const { value, ttlSeconds } = await factory();
      await this.redis.set(fk, value, 'EX', Math.max(1, ttlSeconds));
      return value;
    } finally {
      await this.redis.del(lockKey);
    }
  }
}
