import { MemoryRateLimitStore } from './memory-rate-limit.store';
import { RedisRateLimitStore, type RateLimitRedis } from './redis-rate-limit.store';

describe('MemoryRateLimitStore', () => {
  it('counts hits within one window and keys them separately', async () => {
    const store = new MemoryRateLimitStore();
    expect((await store.hit('a', 60)).count).toBe(1);
    expect((await store.hit('a', 60)).count).toBe(2);
    expect((await store.hit('b', 60)).count).toBe(1);
  });

  it('starts a new window once the old one expires', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-21T10:00:00Z'));
    try {
      const store = new MemoryRateLimitStore();
      const first = await store.hit('a', 60);
      expect(first.count).toBe(1);

      jest.setSystemTime(new Date('2026-09-21T10:01:01Z'));
      const next = await store.hit('a', 60);
      expect(next.count).toBe(1);
      expect(next.resetAt).toBeGreaterThan(first.resetAt);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports itself as per-process so callers can say so honestly', () => {
    expect(new MemoryRateLimitStore().kind).toBe('memory');
  });
});

describe('RedisRateLimitStore', () => {
  function redis(): RateLimitRedis & {
    counts: Map<string, number>;
    ttls: Map<string, number>;
  } {
    const counts = new Map<string, number>();
    const ttls = new Map<string, number>();
    return {
      counts,
      ttls,
      incr: jest.fn(async (key: string) => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next;
      }),
      pexpire: jest.fn(async (key: string, ms: number) => {
        ttls.set(key, ms);
        return 1;
      }),
      pttl: jest.fn(async (key: string) => ttls.get(key) ?? -2),
    };
  }

  // Setting the expiry on every request would slide the window forward forever,
  // letting a steady caller stay just under the limit and never reset.
  it('sets the expiry only on the first hit of a window', async () => {
    const r = redis();
    const store = new RedisRateLimitStore(r);

    await store.hit('app-1', 60);
    await store.hit('app-1', 60);
    await store.hit('app-1', 60);

    expect(r.pexpire).toHaveBeenCalledTimes(1);
    expect(r.counts.get('compliance:ratelimit:app-1')).toBe(3);
  });

  it('re-arms an expiry that went missing rather than counting forever', async () => {
    const r = redis();
    const store = new RedisRateLimitStore(r);
    await store.hit('app-1', 60);
    r.ttls.delete('compliance:ratelimit:app-1');

    const hit = await store.hit('app-1', 60);

    expect(hit.count).toBe(2);
    expect(r.pexpire).toHaveBeenCalledTimes(2);
    expect(hit.resetAt).toBeGreaterThan(Date.now());
  });

  it('reports itself as shared', () => {
    expect(new RedisRateLimitStore(redis()).kind).toBe('redis');
  });
});
