import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import type { IComplianceEventRepository } from '../src/shared/ports/repository.port';
import { ETIMS_ADAPTER, EVENT_REPO } from '../src/shared/tokens';
import type { IEtimsAdapter } from '../src/regulatory/oscu/ports/etims-adapter.port';

type SaleReportDtoBody = {
  id: string;
  status: string;
  saleDetailUrl: string | null;
  receiptNumber: number | null;
  customerTin: string | null;
  internalData: string | null;
  receiptSignature: string | null;
  etimsUrl: string | null;
  salesTaxSummary: Record<string, unknown>;
  itemList: Array<{ itemId: string; quantity: number }>;
};

type SalesReportDetailResponseBody = {
  data: SaleReportDtoBody;
};

type KraRequestSnapshot = {
  tin: string;
  bhfId: string;
  cmcKey: string;
  trdInvcNo: string;
  salesDt: string;
  rcptTyCd: string;
  pmtTyCd: string;
  salesSttsCd: string;
};

type SaleValidationErrorBody = {
  message: string;
  errors: Array<{ code: string }>;
};

describe('Sales API (e2e)', () => {
  let app: INestApplication<App> | null = null;
  let moduleFixture: TestingModule | null = null;

  async function createTestApp(opts?: { etimsAdapter?: IEtimsAdapter }) {
    const builder = Test.createTestingModule({ imports: [AppModule] });
    if (opts?.etimsAdapter) {
      builder.overrideProvider(ETIMS_ADAPTER).useValue(opts.etimsAdapter);
    }

    moduleFixture = await builder.compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    const eventRepo = moduleFixture.get<IComplianceEventRepository>(EVENT_REPO);
    return { app, moduleFixture, eventRepo };
  }

  afterEach(async () => {
    if (app) await app.close();
    app = null;
    moduleFixture = null;
  });

  async function seedCatalogItem(httpServer: App) {
    const merchantId = 'merchant-1';
    const externalId = `qb-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    await request(httpServer).post('/catalog/items').send({
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

  it('POST /api/sales creates a sale and GET /api/sales/:id returns the accepted payload', async () => {
    const { app, eventRepo } = await createTestApp();
    const httpServer: App = app.getHttpServer();
    const { merchantId, itemId } = await seedCatalogItem(httpServer);

    const saleDate = '2026-02-20';
    const traderInvoiceNumber = `INV-${Date.now()}`;

    const res = await request(httpServer)
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

    const body = res.body as SalesReportDetailResponseBody;

    expect(body.data.id).toBeDefined();
    expect(body.data.status).toBe('completed');
    expect(body.data.saleDetailUrl).toBe(`/api/sales/${body.data.id}`);
    expect(body.data.receiptNumber).not.toBeNull();

    const events = await eventRepo.findByDocumentId(body.data.id);
    const accepted = events.find((e) => e.eventType === 'ACCEPTED');
    expect(accepted).toBeDefined();
    expect(
      (accepted!.responseSnapshot as Record<string, unknown>).resultCd,
    ).toBe('000');

    const getRes = await request(httpServer)
      .get(`/api/sales/${body.data.id}`)
      .expect(200);

    const getBody = getRes.body as SalesReportDetailResponseBody;
    expect(getBody.data.id).toBe(body.data.id);
    expect(getBody.data.status).toBe('completed');
    expect(getBody.data.saleDetailUrl).toBe(`/api/sales/${body.data.id}`);
    expect(getBody.data.receiptNumber).not.toBeNull();
    expect(getBody.data.customerTin).toBe('P1234567890');
    expect(getBody.data.itemList[0].itemId).toBe(itemId);
    expect(getBody.data.itemList[0].quantity).toBe(1);

    // Contract checks for request mapping (stored in ACCEPTED event snapshot)
    if (!accepted) throw new Error('Expected ACCEPTED event');
    const responseSnapshot = accepted.responseSnapshot as unknown as {
      request: KraRequestSnapshot;
    };
    const kraRequest = responseSnapshot.request;
    expect(kraRequest.tin).toBe('P1234567890');
    expect(kraRequest.bhfId).toBe('branch-1');
    expect(kraRequest.cmcKey).toBe('cmc-key-stub');
    expect(kraRequest.trdInvcNo).toBe(traderInvoiceNumber);
    expect(kraRequest.salesDt).toBe('20260220');
    expect(kraRequest.rcptTyCd).toBe('S');
    expect(kraRequest.pmtTyCd).toBe('01');
    expect(kraRequest.salesSttsCd).toBe('02');
  });

  it('POST /api/sales?submit=false creates a DRAFT and GET /api/sales/:id returns the correct draft payload', async () => {
    const { app } = await createTestApp();
    const httpServer: App = app.getHttpServer();
    const { merchantId, itemId } = await seedCatalogItem(httpServer);

    const res = await request(httpServer)
      .post('/api/sales?submit=false')
      .send({
        merchantId,
        branchId: 'branch-1',
        saleDate: '2026-02-20',
        traderInvoiceNumber: `INV-DRAFT-${Date.now()}`,
        receiptTypeCode: 'S',
        paymentTypeCode: '01',
        invoiceStatusCode: '02',
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

    const body = res.body as SalesReportDetailResponseBody;
    expect(body.data.status).toBe('pending');
    expect(body.data.receiptNumber).toBeNull();

    const getRes = await request(httpServer)
      .get(`/api/sales/${body.data.id}`)
      .expect(200);

    const getBody = getRes.body as SalesReportDetailResponseBody;
    expect(getBody.data.status).toBe('pending');
    expect(getBody.data.receiptNumber).toBeNull();
  });

  it('POST /dashboard-api/sales and GET /dashboard-api/sales/:id return the accepted payload', async () => {
    const { app } = await createTestApp();
    const httpServer: App = app.getHttpServer();
    const { merchantId, itemId } = await seedCatalogItem(httpServer);

    const res = await request(httpServer)
      .post('/dashboard-api/sales')
      .send({
        merchantId,
        branchId: 'branch-1',
        saleDate: '2026-02-20',
        traderInvoiceNumber: `INV-DASH-${Date.now()}`,
        receiptTypeCode: 'S',
        paymentTypeCode: '01',
        invoiceStatusCode: '02',
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

    const body = res.body as SalesReportDetailResponseBody;
    expect(body.data.status).toBe('completed');

    const getRes = await request(httpServer)
      .get(`/dashboard-api/sales/${body.data.id}`)
      .expect(200);
    const getBody = getRes.body as SalesReportDetailResponseBody;
    expect(getBody.data.status).toBe('completed');
    expect(getBody.data.receiptNumber).not.toBeNull();
  });

  it('POST /dashboard-api/sales?submit=false creates a DRAFT and GET /dashboard-api/sales/:id returns the correct draft payload', async () => {
    const { app } = await createTestApp();
    const httpServer: App = app.getHttpServer();
    const { merchantId, itemId } = await seedCatalogItem(httpServer);

    const res = await request(httpServer)
      .post('/dashboard-api/sales?submit=false')
      .send({
        merchantId,
        branchId: 'branch-1',
        saleDate: '2026-02-20',
        traderInvoiceNumber: `INV-DASH-DRAFT-${Date.now()}`,
        receiptTypeCode: 'S',
        paymentTypeCode: '01',
        invoiceStatusCode: '02',
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

    const body = res.body as SalesReportDetailResponseBody;
    expect(body.data.status).toBe('pending');
    expect(body.data.receiptNumber).toBeNull();

    const getRes = await request(httpServer)
      .get(`/dashboard-api/sales/${body.data.id}`)
      .expect(200);

    const getBody = getRes.body as SalesReportDetailResponseBody;
    expect(getBody.data.status).toBe('pending');
    expect(getBody.data.receiptNumber).toBeNull();
  });

  it('POST /api/sales returns REJECTED when submission fails (non-retryable)', async () => {
    const rejectAdapter: IEtimsAdapter = {
      submitInvoice: () =>
        Promise.resolve({
          success: false,
          error: 'rejected by gateway',
        }),
    };

    const { app } = await createTestApp({ etimsAdapter: rejectAdapter });
    const httpServer: App = app.getHttpServer();
    const { merchantId, itemId } = await seedCatalogItem(httpServer);

    const res = await request(httpServer)
      .post('/api/sales')
      .send({
        merchantId,
        branchId: 'branch-1',
        saleDate: '2026-02-20',
        traderInvoiceNumber: `INV-REJ-${Date.now()}`,
        receiptTypeCode: 'S',
        paymentTypeCode: '01',
        invoiceStatusCode: '02',
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

    const body = res.body as SalesReportDetailResponseBody;
    expect(body.data.status).toBe('failed');
    expect(body.data.receiptNumber).toBeNull();

    const getRes = await request(httpServer)
      .get(`/api/sales/${body.data.id}`)
      .expect(200);
    const getBody = getRes.body as SalesReportDetailResponseBody;
    expect(getBody.data.status).toBe('failed');
    expect(getBody.data.receiptNumber).toBeNull();
  });

  it('POST /api/sales returns RETRYING when submission fails with a retryable error', async () => {
    const retryingAdapter: IEtimsAdapter = {
      submitInvoice: () =>
        Promise.resolve({
          success: false,
          error: 'retryable: upstream timeout',
        }),
    };

    const { app } = await createTestApp({ etimsAdapter: retryingAdapter });
    const httpServer: App = app.getHttpServer();
    const { merchantId, itemId } = await seedCatalogItem(httpServer);

    const res = await request(httpServer)
      .post('/api/sales')
      .send({
        merchantId,
        branchId: 'branch-1',
        saleDate: '2026-02-20',
        traderInvoiceNumber: `INV-RETRY-${Date.now()}`,
        receiptTypeCode: 'S',
        paymentTypeCode: '01',
        invoiceStatusCode: '02',
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

    const body = res.body as SalesReportDetailResponseBody;
    expect(body.data.status).toBe('retrying');
    expect(body.data.receiptNumber).toBeNull();

    const getRes = await request(httpServer)
      .get(`/api/sales/${body.data.id}`)
      .expect(200);
    const getBody = getRes.body as SalesReportDetailResponseBody;
    expect(getBody.data.status).toBe('retrying');
    expect(getBody.data.receiptNumber).toBeNull();
  });

  it('POST /api/sales returns 400 when validation fails (VAT_STANDARD tax mismatch)', async () => {
    const { app } = await createTestApp();
    const httpServer: App = app.getHttpServer();
    const { merchantId, itemId } = await seedCatalogItem(httpServer);

    const res = await request(httpServer)
      .post('/api/sales')
      .send({
        merchantId,
        branchId: 'branch-1',
        saleDate: '2026-02-20',
        traderInvoiceNumber: `INV-BAD-${Date.now()}`,
        receiptTypeCode: 'S',
        paymentTypeCode: '01',
        invoiceStatusCode: '02',
        items: [
          {
            id: itemId,
            quantity: 1,
            unitPrice: 100,
            taxCategory: 'VAT_STANDARD',
            taxAmount: 0,
          },
        ],
      })
      .expect(400);

    const body = res.body as SaleValidationErrorBody;
    expect(body.message).toBe('Sale validation failed');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TAX_VAT_STANDARD_RATE' }),
      ]),
    );
  });

  it('POST /api/sales is idempotent by traderInvoiceNumber (same id returned)', async () => {
    const { app } = await createTestApp();
    const httpServer: App = app.getHttpServer();
    const { merchantId, itemId } = await seedCatalogItem(httpServer);

    const traderInvoiceNumber = `INV-IDEMP-${Date.now()}`;
    const payload = {
      merchantId,
      branchId: 'branch-1',
      saleDate: '2026-02-20',
      traderInvoiceNumber,
      receiptTypeCode: 'S',
      paymentTypeCode: '01',
      invoiceStatusCode: '02',
      items: [
        {
          id: itemId,
          quantity: 1,
          unitPrice: 100,
          taxCategory: 'VAT_STANDARD',
          taxAmount: 16,
        },
      ],
    };

    const first = await request(httpServer)
      .post('/api/sales')
      .send(payload)
      .expect(201);
    const second = await request(httpServer)
      .post('/api/sales')
      .send(payload)
      .expect(201);

    const firstBody = first.body as SalesReportDetailResponseBody;
    const secondBody = second.body as SalesReportDetailResponseBody;

    expect(firstBody.data.id).toBeDefined();
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(secondBody.data.status).toBe('completed');
  });
});
