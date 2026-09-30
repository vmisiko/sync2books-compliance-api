import type {
  IRateLimitStore,
  RateLimitHit,
} from '../../application/ports/rate-limit-store.port';

/** The slice of `ioredis` this store needs. */
export type RateLimitRedis = {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
};

/**
 * Shared fixed-window counter, so the published limit holds across instances.
 *
 * The expiry is set only on the first request of a window (`count === 1`) —
 * setting it on every request would slide the window forward and let a steady
 * caller exceed the limit indefinitely.
 */
export class RedisRateLimitStore implements IRateLimitStore {
  readonly kind = 'redis' as const;

  constructor(
    private readonly redis: RateLimitRedis,
    private readonly keyPrefix = 'compliance:ratelimit',
  ) {}

  async hit(key: string, windowSeconds: number): Promise<RateLimitHit> {
    const windowMs = windowSeconds * 1000;
    const fullKey = `${this.keyPrefix}:${key}`;

    const count = await this.redis.incr(fullKey);
    if (count === 1) {
      await this.redis.pexpire(fullKey, windowMs);
      return { count, resetAt: Date.now() + windowMs };
    }

    const ttl = await this.redis.pttl(fullKey);
    // -1 = key exists with no expiry, -2 = key vanished between the two calls.
    // Either way the safe reading is "a full window from now", which errs
    // towards telling the caller to wait rather than towards letting them
    // hammer a counter that will never reset.
    if (ttl < 0) {
      await this.redis.pexpire(fullKey, windowMs);
      return { count, resetAt: Date.now() + windowMs };
    }
    return { count, resetAt: Date.now() + ttl };
  }
}
