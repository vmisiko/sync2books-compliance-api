import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { withSync2BooksM2m } from './sync2books-m2m.helper';

type SyncItemsResponseBody = {
  merchantId: string;
  branchId: string;
  attempted: number;
  synced: number;
  failed: number;
  results: Array<{
    itemId: string;
    itemCd: string;
    success: boolean;
  }>;
};

describe('Catalog items sync (e2e)', () => {
  let app: INestApplication<App> | null = null;
  let moduleFixture: TestingModule | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
    moduleFixture = null;
  });

  it('POST /catalog/items/sync registers an item and persists itemCd', async () => {
    const builder = Test.createTestingModule({ imports: [AppModule] });
    moduleFixture = await builder.compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const httpServer: App = app.getHttpServer();

    const merchantId = 'merchant-1';
    const externalId = `qb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const itemId = `item-${merchantId}-${externalId}`;

    await withSync2BooksM2m(request(httpServer).post('/catalog/items'), merchantId)
      .send({
        merchantId,
        externalId,
        name: 'Sync Widget',
        itemType: 'GOODS',
        taxCategory: 'VAT_STANDARD',
        internalUnit: 'EA',
        classificationCode: '14111400',
      });

    const syncRes = await withSync2BooksM2m(
      request(httpServer).post('/catalog/items/sync'),
      merchantId,
    )
      .send({
        merchantId,
        branchId: 'branch-1',
        itemIds: [itemId],
      })
      .expect(201);

    const body = syncRes.body as SyncItemsResponseBody;
    expect(body.attempted).toBe(1);
    expect(body.synced).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.results[0].itemId).toBe(itemId);
    expect(body.results[0].itemCd).toBeTruthy();
    expect(body.results[0].success).toBe(true);

    const listed = await withSync2BooksM2m(
      request(httpServer).get(`/catalog/merchants/${merchantId}/items`),
      merchantId,
    ).expect(200);

    const listedBody = listed.body as { items: Array<Record<string, unknown>> };
    const found = listedBody.items.find((i) => i.id === itemId);
    expect(found).toBeDefined();
    expect(found!.registrationStatus).toBe('REGISTERED');
    expect(found!.etimsItemCode).toBeTruthy();
  });
});
