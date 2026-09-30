import { Logger } from '@nestjs/common';
import type { IRateLimitStore } from '../../application/ports/rate-limit-store.port';
import { MemoryRateLimitStore } from './memory-rate-limit.store';
import {
  RedisRateLimitStore,
  type RateLimitRedis,
} from './redis-rate-limit.store';

function loadRedisConstructor(): new (url: string) => RateLimitRedis {
  // Runtime dependency, same as the OSCU token cache: `npm install ioredis`.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('ioredis') as unknown;
  if (typeof mod === 'function') {
    return mod as new (url: string) => RateLimitRedis;
  }
  if (
    mod !== null &&
    typeof mod === 'object' &&
    'default' in mod &&
    typeof (mod as { default: unknown }).default === 'function'
  ) {
    return (mod as { default: new (url: string) => RateLimitRedis }).default;
  }
  throw new Error('Expected ioredis export (npm install ioredis)');
}

/**
 * Redis when `COMPLIANCE_RATE_LIMIT_REDIS_URL` (or the OSCU token cache's Redis)
 * is configured, per-process otherwise.
 *
 * Falling back is deliberate — a missing Redis must not stop the service
 * booting — but it is logged at warn, because a per-process limiter behind
 * several instances gives every caller a multiple of the limit we publish in
 * `X-RateLimit-Limit`, and nobody should discover that from the source.
 */
export function createRateLimitStore(): IRateLimitStore {
  const logger = new Logger('RateLimitStore');
  const url =
    process.env.COMPLIANCE_RATE_LIMIT_REDIS_URL ??
    process.env.ETIMS_OSCU_REDIS_URL;

  if (!url) {
    logger.warn(
      'No Redis configured (COMPLIANCE_RATE_LIMIT_REDIS_URL): API rate limits are per-process and will not hold across instances.',
    );
    return new MemoryRateLimitStore();
  }

  try {
    const RedisCtor = loadRedisConstructor();
    logger.log('API rate limits are backed by Redis.');
    return new RedisRateLimitStore(new RedisCtor(url));
  } catch (error) {
    logger.error(
      `Redis rate-limit store unavailable, falling back to per-process counting: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return new MemoryRateLimitStore();
  }
}
