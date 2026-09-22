import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';
import { DashboardCustomersApplicationService } from '../../../dashboard-customers/application/dashboard-customers.application.service';
import { DashboardCustomersController } from '../../../dashboard-customers/presentation/dashboard-customers.controller';
import { DashboardSuppliersApplicationService } from '../../../dashboard-suppliers/application/dashboard-suppliers.application.service';
import { DashboardSuppliersController } from '../../../dashboard-suppliers/presentation/dashboard-suppliers.controller';
import { DashboardJwtAuthGuard } from './dashboard-jwt-auth.guard';

/**
 * Route-level proof for the customer and supplier routes, which take their
 * scope from `merchantId` rather than from ActiveTenantGuard. Their services
 * look a row up by `{ id, merchantId }`, so the merchantId reaching them has to
 * be one the caller's organization owns -- and TypeORM drops an `undefined`
 * where-key, so "no merchantId at all" has to be refused too, or PATCH :id finds
 * the row by bare id.
 *
 * The real controller runs behind the real MerchantOwnershipGuard and
 * ActiveTenantGuard; only identity (the JWT guard), data and the service
 * underneath are faked, so a "not called" assertion means the handler never ran.
 */
describe.each([
  {
    name: 'customers',
    base: '/dashboard-api/customers',
    controller: DashboardCustomersController,
    service: DashboardCustomersApplicationService,
    pull: 'pullCustomers',
  },
  {
    name: 'suppliers',
    base: '/dashboard-api/suppliers',
    controller: DashboardSuppliersController,
    service: DashboardSuppliersApplicationService,
    pull: 'pullSuppliers',
  },
] as Array<{
  name: string;
  base: string;
  controller: Type<unknown>;
  service: Type<unknown>;
  pull: string;
}>)('dashboard-api/$name -- cross-organization access', ({ base, controller, service, pull }) => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';
  const tenants = [
    { id: 'tenant-a', sync2booksCompanyId: 'company-a', organizationId: ORG_A },
    { id: 'tenant-b', sync2booksCompanyId: 'company-b', organizationId: ORG_B },
  ];

  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  const http = () => request(app.getHttpServer() as App);
  const as = (org: string, tenantId?: string) => ({
    'x-test-org': org,
    ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
  });

  beforeEach(async () => {
    svc = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'new-row' }),
      update: jest.fn().mockResolvedValue({ id: 'row-1' }),
      verifyKra: jest.fn().mockResolvedValue({ found: false }),
      [pull]: jest.fn().mockResolvedValue({ pulled: 0 }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [controller],
      providers: [
        { provide: service, useValue: svc },
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
  });

  afterEach(async () => {
    await app.close();
  });

  describe('PATCH :id', () => {
    it('updates a row under the caller\'s own merchantId', async () => {
      await http()
        .patch(`${base}/row-1?merchantId=company-a`)
        .set(as(ORG_A))
        .send({ name: 'Renamed' })
        .expect(200);
      expect(svc.update).toHaveBeenCalledWith('company-a', 'row-1', {
        name: 'Renamed',
      });
    });

    // The exposure: without a merchantId the where-clause lost its merchant key
    // and the service found -- and saved -- another organization's row by id.
    it('400s with no merchantId instead of looking the row up by bare id', async () => {
      await http()
        .patch(`${base}/row-of-org-b`)
        .set(as(ORG_A))
        .send({ name: 'Hijacked' })
        .expect(400);
      expect(svc.update).not.toHaveBeenCalled();
    });

    it('400s a repeated merchantId rather than treating it as absent', async () => {
      await http()
        .patch(`${base}/row-of-org-b?merchantId=company-a&merchantId=company-b`)
        .set(as(ORG_A))
        .send({ name: 'Hijacked' })
        .expect(400);
      expect(svc.update).not.toHaveBeenCalled();
    });

    it("403s another organization's merchantId", async () => {
      await http()
        .patch(`${base}/row-of-org-b?merchantId=company-b`)
        .set(as(ORG_A))
        .send({ name: 'Hijacked' })
        .expect(403);
      expect(svc.update).not.toHaveBeenCalled();
    });

    it('403s an owned query merchantId paired with a foreign body one', async () => {
      await http()
        .patch(`${base}/row-of-org-b?merchantId=company-a`)
        .set(as(ORG_A))
        .send({ merchantId: 'company-b', name: 'Hijacked' })
        .expect(403);
      expect(svc.update).not.toHaveBeenCalled();
    });
  });

  describe('GET / and GET /verify-kra', () => {
    it("lists the caller's own merchant", async () => {
      await http().get(`${base}?merchantId=company-a`).set(as(ORG_A)).expect(200);
      expect(svc.list).toHaveBeenCalledWith('company-a', undefined);
    });

    it.each([
      ['no merchantId', `?`, 400],
      ['a foreign merchantId', `?merchantId=company-b`, 403],
    ])('refuses a list with %s', async (_n, qs, status) => {
      await http().get(`${base}${qs}`).set(as(ORG_A)).expect(status);
      expect(svc.list).not.toHaveBeenCalled();
    });

    it.each([
      ['no merchantId', '?branchId=b&tin=A1', 400],
      ['a foreign merchantId', '?merchantId=company-b&branchId=b&tin=A1', 403],
    ])('refuses verify-kra with %s', async (_n, qs, status) => {
      await http().get(`${base}/verify-kra${qs}`).set(as(ORG_A)).expect(status);
      expect(svc.verifyKra).not.toHaveBeenCalled();
    });
  });

  describe('POST / (merchantId in the body)', () => {
    it('creates under the caller\'s own merchant', async () => {
      await http()
        .post(base)
        .set(as(ORG_A))
        .send({ merchantId: 'company-a', name: 'Acme' })
        .expect(201);
      expect(svc.create).toHaveBeenCalledTimes(1);
    });

    it("403s a create under another organization's merchant", async () => {
      await http()
        .post(base)
        .set(as(ORG_A))
        .send({ merchantId: 'company-b', name: 'Planted' })
        .expect(403);
      expect(svc.create).not.toHaveBeenCalled();
    });

    // Handler reads the body; a guard that looked only at the query would have
    // authorized this and planted a row under the other organization.
    it('403s an owned query merchantId paired with a foreign body one', async () => {
      await http()
        .post(`${base}?merchantId=company-a`)
        .set(as(ORG_A))
        .send({ merchantId: 'company-b', name: 'Planted' })
        .expect(403);
      expect(svc.create).not.toHaveBeenCalled();
    });
  });

  // `pull` names no merchantId on purpose: it takes the business from
  // ActiveTenantGuard's x-tenant-id header, which is what @MerchantIdOptional()
  // hands the decision to.
  describe('POST /pull', () => {
    it('runs for a business the caller owns, with no merchantId', async () => {
      await http().post(`${base}/pull`).set(as(ORG_A, 'tenant-a')).expect(200);
      expect(svc[pull]).toHaveBeenCalledWith('tenant-a', undefined);
    });

    it("403s another organization's tenant header", async () => {
      await http().post(`${base}/pull`).set(as(ORG_A, 'tenant-b')).expect(403);
      expect(svc[pull]).not.toHaveBeenCalled();
    });

    it('400s with no tenant header', async () => {
      await http().post(`${base}/pull`).set(as(ORG_A)).expect(400);
      expect(svc[pull]).not.toHaveBeenCalled();
    });
  });
});
