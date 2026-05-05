import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { withSync2BooksM2m } from './sync2books-m2m.helper';

/** Valid UUID v4-style for tests */
const SYNC_ITEM_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const SYNC_BATCH_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const APPLICATION_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const CONNECTION_ID = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
/** companyId / merchantId must be UUID-shaped for Pattern 2 header validation */
const COMPANY_ID = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55';

function parseCorrelationCell(raw: unknown): Record<string, unknown> {
  if (raw == null) {
    return {};
  }
  if (typeof raw === 'string') {
    return JSON.parse(raw) as Record<string, unknown>;
  }
  return raw as Record<string, unknown>;
}

describe('sync2booksCorrelation on catalog_items (Pattern 2, e2e)', () => {
  let app: INestApplication<App> | null = null;
  let moduleFixture: TestingModule | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
    moduleFixture = null;
  });

  async function bootstrap(): Promise<{
    app: INestApplication;
    ds: DataSource;
    httpServer: App;
  }> {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const nest = moduleFixture.createNestApplication({ logger: false });
    await nest.init();
    app = nest as INestApplication<App>;
    const ds = moduleFixture.get<DataSource>(DataSource);
    return {
      app: nest,
      ds,
      httpServer: nest.getHttpServer() as unknown as App,
    };
  }

  it('persists JSON correlation on the catalog row when Pattern 2 headers are sent', async () => {
    const { ds, httpServer } = await bootstrap();

    const merchantId = COMPANY_ID;
    const ext = `ext-corr-${Date.now()}`;

    const res = await withSync2BooksM2m(
      request(httpServer).post('/catalog/items'),
      merchantId,
      {
        'x-sync2books-sync-batch-id': SYNC_BATCH_ID,
        'x-sync2books-sync-item-id': SYNC_ITEM_ID,
        'x-sync2books-application-id': APPLICATION_ID,
        'x-sync2books-connection-id': CONNECTION_ID,
      },
    )
      .send({
        merchantId,
        externalId: ext,
        name: 'Correlation item',
        itemType: 'GOODS',
        taxCategory: 'VAT_STANDARD',
        internalUnit: 'EA',
        classificationCode: '14111400',
      })
      .expect(201);

    const itemId = (res.body as { item?: { id?: string } }).item?.id;
    expect(itemId).toBeDefined();

    const rows = await ds.query(
      'SELECT sync2booksCorrelation FROM catalog_items WHERE id = ?',
      [itemId],
    );
    const corr = parseCorrelationCell(rows[0]?.sync2booksCorrelation);
    expect(corr.syncItemId).toBe(SYNC_ITEM_ID);
    expect(corr.syncBatchId).toBe(SYNC_BATCH_ID);
    expect(corr.applicationId).toBe(APPLICATION_ID);
    expect(corr.connectionId).toBe(CONNECTION_ID);
    expect(corr.companyId).toBe(COMPANY_ID);
  });

  it('updates stored correlation when the same item is registered again with new batch id', async () => {
    const { ds, httpServer } = await bootstrap();

    const merchantId = COMPANY_ID;
    const ext = `ext-upsert-${Date.now()}`;

    const headersForBatch = (batch: string) =>
      withSync2BooksM2m(
        request(httpServer).post('/catalog/items'),
        merchantId,
        {
          'x-sync2books-sync-batch-id': batch,
          'x-sync2books-sync-item-id': SYNC_ITEM_ID,
          'x-sync2books-application-id': APPLICATION_ID,
          'x-sync2books-connection-id': CONNECTION_ID,
        },
      ).send({
        merchantId,
        externalId: ext,
        name: 'Upsert item',
        itemType: 'GOODS',
        taxCategory: 'VAT_STANDARD',
        internalUnit: 'EA',
        classificationCode: '14111400',
      });

    await headersForBatch(SYNC_BATCH_ID).expect(201);

    const otherBatch = '1111bc99-9c0b-4ef8-bb6d-bbb9bd380aaa';
    const second = await headersForBatch(otherBatch).expect(201);
    const itemId = (second.body as { item?: { id?: string } }).item?.id;

    const rows = await ds.query(
      'SELECT COUNT(*) AS c FROM catalog_items WHERE id = ?',
      [itemId],
    );
    expect(Number(rows[0].c)).toBe(1);

    const corrRows = await ds.query(
      'SELECT sync2booksCorrelation FROM catalog_items WHERE id = ?',
      [itemId],
    );
    const corr = parseCorrelationCell(corrRows[0]?.sync2booksCorrelation);
    expect(corr.syncBatchId).toBe(otherBatch);
  });
});
