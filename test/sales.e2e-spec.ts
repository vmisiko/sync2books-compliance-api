import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import type { IComplianceEventRepository } from '../src/shared/ports/repository.port';
import { EVENT_REPO } from '../src/shared/tokens';

describe('Sales API (e2e)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let eventRepo: IComplianceEventRepository;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    eventRepo = moduleFixture.get<IComplianceEventRepository>(EVENT_REPO);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function seedCatalogItem() {
    const merchantId = 'merchant-1';
    const externalId = 'qb-1';

    await request(app.getHttpServer()).post('/catalog/items').send({
      merchantId,
      externalId,
      name: 'Widget',
      itemType: 'GOODS',
      taxCategory: 'VAT_STANDARD',
      internalUnit: 'EA',
      classificationCode: '14111400',
    });

    return {
      merchantId,
      externalId,
      itemId: `item-${merchantId}-${externalId}`,
    };
  }

  it('POST /api/sales creates + submits sale and stores OSCU-style KRA response', async () => {
    const { merchantId, itemId } = await seedCatalogItem();

    const saleDate = '2026-02-20';
    const traderInvoiceNumber = `INV-${Date.now()}`;

    const res = await request(app.getHttpServer())
      .post('/api/sales')
      .send({
        merchantId,
        branchId: 'branch-1',
        saleDate,
        traderInvoiceNumber,
        receiptTypeCode: 'S',
        paymentTypeCode: '01',
        invoiceStatusCode: '02',
        customerTin: 'P1234567890',
        items: [
          {
            id: itemId,
            quantity: 1,
            unitPrice: 100,
            taxCategory: 'VAT_STANDARD',
            taxAmount: 16,
          },
        ],
      })
      .expect(201);

    const body = res.body as unknown as {
      id: string;
      status: string;
      receiptNumber: string | null;
    };
    expect(body.id).toBeDefined();
    expect(body.status).toBe('ACCEPTED');
    expect(String(body.receiptNumber)).toMatch(/^ETR-/);

    const events = await eventRepo.findByDocumentId(body.id);
    const accepted = events.find((e) => e.eventType === 'ACCEPTED');
    expect(accepted).toBeDefined();

    const responseSnapshot = accepted?.responseSnapshot as Record<
      string,
      unknown
    >;
    expect(responseSnapshot.resultCd).toBe('000');
    expect(responseSnapshot.resultMsg).toBe('It is succeeded');
    expect(responseSnapshot.resultDt).toBeDefined();

    const data = responseSnapshot.data as Record<string, unknown>;
    expect(data.curRcptNo).toBeDefined();
    expect(data.totRcptNo).toBeDefined();

    const kraRequest = responseSnapshot.request as Record<string, unknown>;
    expect(kraRequest.tin).toBe('P1234567890');
    expect(kraRequest.bhfId).toBe('branch-1');
    expect(kraRequest.cmcKey).toBe('cmc-key-stub');
    expect(kraRequest.trdInvcNo).toBe(traderInvoiceNumber);
    expect(kraRequest.salesDt).toBe('20260220');
    expect(kraRequest.rcptTyCd).toBe('S');
    expect(kraRequest.pmtTyCd).toBe('01');
    expect(kraRequest.salesSttsCd).toBe('02');
  });

  it('POST /dashboard-api/sales behaves the same', async () => {
    const { merchantId, itemId } = await seedCatalogItem();

    const res = await request(app.getHttpServer())
      .post('/dashboard-api/sales')
      .send({
        merchantId,
        branchId: 'branch-1',
        saleDate: '2026-02-20',
        traderInvoiceNumber: `INV-${Date.now()}`,
        receiptTypeCode: 'S',
        paymentTypeCode: '01',
        invoiceStatusCode: '02',
        items: [
          {
            id: itemId,
            quantity: 2,
            unitPrice: 50,
            taxCategory: 'VAT_STANDARD',
            taxAmount: 16,
          },
        ],
      })
      .expect(201);

    const body = res.body as unknown as {
      id: string;
      status: string;
      receiptNumber: string | null;
    };
    expect(body.status).toBe('ACCEPTED');
    expect(String(body.receiptNumber)).toMatch(/^ETR-/);
  });
});
