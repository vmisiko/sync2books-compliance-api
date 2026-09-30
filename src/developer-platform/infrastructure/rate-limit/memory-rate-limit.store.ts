import type {
  IRateLimitStore,
  RateLimitHit,
} from '../../application/ports/rate-limit-store.port';

/**
 * Per-process fixed-window counter. Correct for a single instance and nothing
 * more: behind N instances a caller effectively gets N times the limit, which
 * is why {@link RedisRateLimitStore} exists and why the platform documentation
 * says which one is deployed rather than implying a shared limiter.
 */
export class MemoryRateLimitStore implements IRateLimitStore {
  readonly kind = 'memory' as const;

  private readonly windows = new Map<string, RateLimitHit>();
  /** Swept lazily; a busy key is rewritten anyway and an idle one is dropped. */
  private lastSweepAt = 0;

  async hit(key: string, windowSeconds: number): Promise<RateLimitHit> {
    const now = Date.now();
    this.sweep(now);

    const existing = this.windows.get(key);
    if (existing && existing.resetAt > now) {
      existing.count += 1;
      return { ...existing };
    }

    const fresh: RateLimitHit = {
      count: 1,
      resetAt: now + windowSeconds * 1000,
    };
    this.windows.set(key, fresh);
    return { ...fresh };
  }

  private sweep(now: number): void {
    if (now - this.lastSweepAt < 60_000) return;
    this.lastSweepAt = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
