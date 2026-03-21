import { Module } from '@nestjs/common';
import { EtimsAdapterStub } from './adapters/etims-adapter.stub';
import { EtimsAdapterHttp } from './adapters/etims-adapter.http';
import { ETIMS_ADAPTER } from '../../shared/tokens';
import { InMemoryApigeeTokenCache } from './infrastructure/apigee-token-cache.memory';
import { RedisApigeeTokenCache } from './infrastructure/apigee-token-cache.redis';
import type { RedisLike } from './infrastructure/redis-like';
import type { OscuPathStyle } from './transport/oscu-endpoints';

function loadRedisConstructor(): new (url: string) => RedisLike {
  // Runtime dependency: `npm install ioredis`
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('ioredis') as unknown;
  if (typeof mod === 'function') {
    return mod as new (url: string) => RedisLike;
  }
  if (
    mod !== null &&
    typeof mod === 'object' &&
    'default' in mod &&
    typeof (mod as { default: unknown }).default === 'function'
  ) {
    return (mod as { default: new (url: string) => RedisLike }).default;
  }
  throw new Error('Expected ioredis export (npm install ioredis)');
}

function createRedisApigeeTokenCache(redisUrl: string): RedisApigeeTokenCache {
  const RedisCtor = loadRedisConstructor();
  return new RedisApigeeTokenCache(new RedisCtor(redisUrl));
}

@Module({
  providers: [
    {
      provide: ETIMS_ADAPTER,
      useFactory: () => {
        const mode = (process.env.ETIMS_ADAPTER_MODE ?? '').toLowerCase();
        const isTest = process.env.NODE_ENV === 'test';
        if (isTest || mode === '' || mode === 'stub') {
          return new EtimsAdapterStub();
        }
        if (mode === 'http') {
          const pathStyle: OscuPathStyle =
            (process.env.ETIMS_OSCU_PATH_STYLE ?? 'legacy').toLowerCase() ===
            'integrator'
              ? 'integrator'
              : 'legacy';
          const sandboxDefault =
            pathStyle === 'integrator'
              ? 'https://sbx.kra.go.ke/etims-oscu/api/v1'
              : 'https://etims-api-sbx.kra.go.ke/etims-api';
          const productionDefault = 'https://etims-api.kra.go.ke/etims-api';

          const clientId = process.env.ETIMS_OSCU_APIGEE_CLIENT_ID;
          const clientSecret = process.env.ETIMS_OSCU_APIGEE_CLIENT_SECRET;
          const redisUrl = process.env.ETIMS_OSCU_REDIS_URL;
          const apigeeTokenCache =
            clientId && clientSecret
              ? redisUrl
                ? createRedisApigeeTokenCache(redisUrl)
                : new InMemoryApigeeTokenCache()
              : undefined;

          return new EtimsAdapterHttp({
            pathStyle,
            sandboxBaseUrl:
              process.env.ETIMS_OSCU_SANDBOX_BASE_URL ?? sandboxDefault,
            productionBaseUrl:
              process.env.ETIMS_OSCU_PROD_BASE_URL ?? productionDefault,
            timeoutMs: process.env.ETIMS_OSCU_TIMEOUT_MS
              ? Number(process.env.ETIMS_OSCU_TIMEOUT_MS)
              : undefined,
            defaultApigeeAppId: process.env.ETIMS_OSCU_APIGEE_APP_ID,
            defaultBearerAccessToken: process.env.ETIMS_OSCU_BEARER_TOKEN,
            apigeeClientId: clientId,
            apigeeClientSecret: clientSecret,
            apigeeTokenBaseUrlSandbox:
              process.env.ETIMS_OSCU_TOKEN_BASE_URL_SANDBOX,
            apigeeTokenBaseUrlProduction:
              process.env.ETIMS_OSCU_TOKEN_BASE_URL_PROD,
            tokenRefreshBufferMs: process.env.ETIMS_OSCU_TOKEN_REFRESH_BUFFER_MS
              ? Number(process.env.ETIMS_OSCU_TOKEN_REFRESH_BUFFER_MS)
              : undefined,
            apigeeTokenCache,
          });
        }
        return new EtimsAdapterStub();
      },
    },
  ],
  exports: [ETIMS_ADAPTER],
})
export class EtimsModule {}
