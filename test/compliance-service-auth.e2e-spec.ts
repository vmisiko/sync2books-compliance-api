import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { withSync2BooksM2m } from './sync2books-m2m.helper';

describe('Compliance Sync2Books M2M auth (e2e)', () => {
  let app: INestApplication<App> | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  async function bootstrap(): Promise<INestApplication<App>> {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const nest = moduleFixture.createNestApplication({ logger: false });
    await nest.init();
    app = nest;
    return nest;
  }

  it('POST /catalog/items returns 401 without Authorization when COMPLIANCE_SERVICE_TOKEN is set', async () => {
    const a = await bootstrap();
    const http = a.getHttpServer();
    await request(http)
      .post('/catalog/items')
      .send({
        merchantId: 'm-guard',
        externalId: `ext-${Date.now()}`,
        name: 'Guard item',
        itemType: 'GOODS',
        taxCategory: 'VAT_STANDARD',
        internalUnit: 'EA',
        classificationCode: '14111400',
      })
      .expect(401);
  });

  it('POST /catalog/items returns 400 with Bearer but missing x-sync2books-company-id', async () => {
    const a = await bootstrap();
    const http = a.getHttpServer();
    const token =
      process.env.COMPLIANCE_SERVICE_TOKEN?.trim() ??
      'e2e-compliance-service-token';
    await request(http)
      .post('/catalog/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        merchantId: 'm-guard',
        externalId: `ext-${Date.now()}`,
        name: 'Guard item',
        itemType: 'GOODS',
        taxCategory: 'VAT_STANDARD',
        internalUnit: 'EA',
        classificationCode: '14111400',
      })
      .expect(400);
  });

  it('POST /catalog/items succeeds when Bearer matches and company header present', async () => {
    const a = await bootstrap();
    const http = a.getHttpServer();
    const merchantId = 'm-guard-ok';
    const externalId = `ext-${Date.now()}`;
    const res = await withSync2BooksM2m(
      request(http).post('/catalog/items'),
      merchantId,
    )
      .send({
        merchantId,
        externalId,
        name: 'OK item',
        itemType: 'GOODS',
        taxCategory: 'VAT_STANDARD',
        internalUnit: 'EA',
        classificationCode: '14111400',
      })
      .expect(201);

    const body = res.body as { created?: boolean; item?: unknown };
    expect(body.created === true || body.item).toBeTruthy();
  });
});
