import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { InvoiceReceiptPushbackService } from '../../integration/platform-outbound/invoice-receipt-pushback.service';
import { MailerService } from '../../mailer/mailer.service';
import { DOCUMENT_REPO } from '../../shared/tokens';
import { ComplianceStatus } from '../../shared/domain/enums/compliance-status.enum';
import { SalesService } from '../application/sales.service';
import { DashboardSalesController } from './dashboard-sales.controller';

/**
 * Route-level proof that one organization cannot read or act on another's sale
 * through dashboard-api/sales. The real controller runs behind the real
 * MerchantOwnershipGuard and SaleOwnershipGuard; only identity (the JWT guard),
 * data and the services underneath are faked, so a 404/403 here is the
 * guards' doing, and "not called" assertions show the handler never ran.
 */
describe('DashboardSalesController -- cross-organization access', () => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';

  const tenants = [
    { id: 'tenant-a', sync2booksCompanyId: 'company-a', organizationId: ORG_A },
    { id: 'tenant-b', sync2booksCompanyId: 'company-b', organizationId: ORG_B },
    { id: 'tenant-orphan', sync2booksCompanyId: 'company-orphan', organizationId: null },
  ];

  const acceptedSale = (id: string, merchantId: string) => ({
    id,
    merchantId,
    branchId: 'branch-1',
    complianceStatus: ComplianceStatus.ACCEPTED,
  });
  const documents: Record<string, ReturnType<typeof acceptedSale>> = {
    'doc-a': acceptedSale('doc-a', 'company-a'),
    'doc-b': acceptedSale('doc-b', 'company-b'),
    'doc-orphan': acceptedSale('doc-orphan', 'company-orphan'),
    'doc-no-business': acceptedSale('doc-no-business', 'company-gone'),
  };

  let app: INestApplication;
  let http: () => ReturnType<typeof request.agent>;
  let sales: Record<string, jest.Mock>;
  let mailer: { send: jest.Mock };

  beforeEach(async () => {
    sales = {
      getNormalizedSaleReport: jest.fn(async (id: string) => ({
        id,
        customerEmail: 'customer@example.invalid',
        traderInvoiceNumber: 'INV-1',
        itemList: [],
      })),
      getEtimsReceiptPdf: jest.fn(async () => Buffer.from('%PDF-fake')),
      findDocumentForMerchant: jest.fn(async (id: string, merchantId: string) =>
        documents[id]?.merchantId === merchantId ? documents[id] : null,
      ),
      listNormalizedSaleReports: jest.fn(async () => ({ data: [] })),
      createDocument: jest.fn(),
      submitDraftDocument: jest.fn(),
      retrySales: jest.fn(async () => ({ results: [] })),
    };
    mailer = { send: jest.fn(async () => ({ sent: true })) };

    const moduleRef = await Test.createTestingModule({
      controllers: [DashboardSalesController],
      providers: [
        { provide: SalesService, useValue: sales },
        { provide: MailerService, useValue: mailer },
        {
          provide: InvoiceReceiptPushbackService,
          useValue: { notifyForRetriedDocuments: jest.fn() },
        },
        {
          provide: DOCUMENT_REPO,
          useValue: { findById: async (id: string) => documents[id] ?? null },
        },
        {
          provide: ComplianceOrganizationApplicationService,
          useValue: {
            getTenantBySync2booksCompanyId: async (c: string) =>
              tenants.find((t) => t.sync2booksCompanyId === c) ?? null,
            getTenantById: async (id: string) =>
              tenants.find((t) => t.id === id) ?? null,
          },
        },
      ],
    })
      // Identity is the only thing faked: the caller's organization comes from a
      // header instead of a signed token.
      .overrideGuard(DashboardJwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          const req = context.switchToHttp().getRequest() as {
            headers: Record<string, string>;
            user?: unknown;
          };
          req.user = {
            userId: 'user-1',
            role: 'admin',
            organizationId: req.headers['x-test-org'],
          };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    http = () => request(app.getHttpServer() as App) as never;
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (org: string) => ({ 'x-test-org': org });
  const encode = encodeURIComponent;

  describe('routes addressed by a document id', () => {
    const routes: Array<[string, (id: string, org: string) => request.Test]> = [
      [
        'GET :id',
        (id, org) => http().get(`/dashboard-api/sales/${encode(id)}`).set(as(org)),
      ],
      [
        'GET :id/receipt',
        (id, org) =>
          http().get(`/dashboard-api/sales/${encode(id)}/receipt`).set(as(org)),
      ],
      [
        'GET :id/receipt?copy=true',
        (id, org) =>
          http()
            .get(`/dashboard-api/sales/${encode(id)}/receipt?copy=true`)
            .set(as(org)),
      ],
      [
        'POST :id/email',
        (id, org) =>
          http()
            .post(`/dashboard-api/sales/${encode(id)}/email`)
            .set(as(org))
            .send({ email: 'attacker@example.invalid' }),
      ],
    ];

    describe.each(routes)('%s', (_name, call) => {
      it("serves the caller's own document", async () => {
        const res = await call('doc-a', ORG_A);
        expect(res.status).toBeLessThan(300);
      });

      it.each([
        ["B reading A's", 'doc-a', ORG_B],
        ["A reading B's", 'doc-b', ORG_A],
      ])('404s %s document and never reaches the handler', async (_n, id, org) => {
        const res = await call(id, org);
        expect(res.status).toBe(404);
        expect(sales.getNormalizedSaleReport).not.toHaveBeenCalled();
        expect(sales.getEtimsReceiptPdf).not.toHaveBeenCalled();
        expect(mailer.send).not.toHaveBeenCalled();
      });

      it('answers a foreign, an unknown and an unowned id identically', async () => {
        const foreign = await call('doc-b', ORG_A);
        const unknown = await call('doc-does-not-exist', ORG_A);
        const unowned = await call('doc-orphan', ORG_A);
        const orphaned = await call('doc-no-business', ORG_A);

        expect(foreign.status).toBe(404);
        for (const other of [unknown, unowned, orphaned]) {
          expect(other.status).toBe(404);
          expect(other.body).toEqual(foreign.body);
        }
      });
    });

    it('never emails a foreign sale to a caller-chosen address', async () => {
      await http()
        .post(`/dashboard-api/sales/${encode('doc-b')}/email`)
        .set(as(ORG_A))
        .send({ email: 'attacker@example.invalid' })
        .expect(404);
      expect(mailer.send).not.toHaveBeenCalled();
    });

    it('emails the caller\'s own sale', async () => {
      await http()
        .post(`/dashboard-api/sales/${encode('doc-a')}/email`)
        .set(as(ORG_A))
        .send({ email: 'me@example.invalid' })
        .expect(201);
      expect(mailer.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('express credit note (saleId in the body)', () => {
    const body = (saleId: string, merchantId = 'company-a') => ({
      merchantId,
      branchId: 'branch-1',
      saleId,
      traderInvoiceNumber: 'CN-1',
      returnDate: '2026-09-21',
    });
    const post = (b: object, org = ORG_A) =>
      http()
        .post('/dashboard-api/sales/credit-notes/express?submit=false')
        .set(as(org))
        .send(b);

    it("404s another organization's saleId under the caller's own merchantId", async () => {
      const res = await post(body('doc-b'));
      expect(res.status).toBe(404);
      expect(sales.createDocument).not.toHaveBeenCalled();
    });

    it('answers a foreign and an unknown saleId identically', async () => {
      const foreign = await post(body('doc-b'));
      const unknown = await post(body('doc-does-not-exist'));
      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual(foreign.body);
    });

    it("403s another organization's merchantId", async () => {
      await post(body('doc-b', 'company-b')).expect(403);
      expect(sales.createDocument).not.toHaveBeenCalled();
    });
  });

  describe('merchantId-bearing routes', () => {
    it('refuses a sync that pairs an owned query merchantId with a foreign body one', async () => {
      await http()
        .post('/dashboard-api/sales/sync?merchantId=company-a')
        .set(as(ORG_A))
        .send({ merchantId: 'company-b' })
        .expect(403);
      expect(sales.retrySales).not.toHaveBeenCalled();
    });

    it('refuses a create that pairs an owned query merchantId with a foreign body one', async () => {
      await http()
        .post('/dashboard-api/sales?merchantId=company-a&submit=false')
        .set(as(ORG_A))
        .send({ merchantId: 'company-b', items: [] })
        .expect(403);
      expect(sales.createDocument).not.toHaveBeenCalled();
    });

    it('refuses a sync for another organization\'s merchantId', async () => {
      await http()
        .post('/dashboard-api/sales/sync')
        .set(as(ORG_A))
        .send({ merchantId: 'company-b' })
        .expect(403);
      expect(sales.retrySales).not.toHaveBeenCalled();
    });

    it("403s a list for another organization's merchantId", async () => {
      await http()
        .get('/dashboard-api/sales?merchantId=company-b')
        .set(as(ORG_A))
        .expect(403);
      expect(sales.listNormalizedSaleReports).not.toHaveBeenCalled();
    });

    it.each([
      ['no merchantId', '/dashboard-api/sales'],
      ['a repeated merchantId', '/dashboard-api/sales?merchantId=company-a&merchantId=company-b'],
    ])('400s a list with %s', async (_n, url) => {
      await http().get(url).set(as(ORG_A)).expect(400);
      expect(sales.listNormalizedSaleReports).not.toHaveBeenCalled();
    });

    it("lists the caller's own merchant", async () => {
      await http()
        .get('/dashboard-api/sales?merchantId=company-a')
        .set(as(ORG_A))
        .expect(200);
      expect(sales.listNormalizedSaleReports).toHaveBeenCalledWith(
        expect.objectContaining({ merchantId: 'company-a' }),
      );
    });
  });
});
