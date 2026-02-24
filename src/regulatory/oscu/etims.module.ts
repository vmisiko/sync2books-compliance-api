import { Module } from '@nestjs/common';
import { EtimsAdapterStub } from './adapters/etims-adapter.stub';
import { EtimsAdapterHttp } from './adapters/etims-adapter.http';
import { ETIMS_ADAPTER } from '../../shared/tokens';

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
          return new EtimsAdapterHttp({
            sandboxBaseUrl: process.env.ETIMS_OSCU_SANDBOX_BASE_URL,
            productionBaseUrl: process.env.ETIMS_OSCU_PROD_BASE_URL,
            timeoutMs: process.env.ETIMS_OSCU_TIMEOUT_MS
              ? Number(process.env.ETIMS_OSCU_TIMEOUT_MS)
              : undefined,
          });
        }
        return new EtimsAdapterStub();
      },
    },
  ],
  exports: [ETIMS_ADAPTER],
})
export class EtimsModule {}
