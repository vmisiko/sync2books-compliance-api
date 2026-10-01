import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { DashboardRole } from '../../shared/domain/enums/dashboard-role.enum';
import { DASHBOARD_USER_REPO } from '../../shared/tokens';
import { DashboardAuthApplicationService } from '../application/dashboard-auth.application.service';
import { DashboardAdminGuard } from '../infrastructure/guards/dashboard-admin.guard';
import { DashboardJwtAuthGuard } from '../infrastructure/guards/dashboard-jwt-auth.guard';
import { DashboardAuthController } from './dashboard-auth.controller';

/**
 * Route-level proof that member management is admin-only. The real controller
 * runs behind the real DashboardAdminGuard; only identity (the JWT guard), the
 * user rows and the service underneath are faked, so a "not called" assertion
 * means the handler never ran.
 *
 * The JWT guard stub always claims `role: 'admin'` -- the admin guard must
 * decide from the user row, never from the token's role claim.
 */
describe('dashboard-api/auth members -- admin-only management', () => {
  const ORG = 'org-a';
  const rows = {
    admin: {
      id: 'admin-1',
      organizationId: ORG,
      role: DashboardRole.ADMIN,
      status: 'active',
    },
    accountant: {
      id: 'acct-1',
      organizationId: ORG,
      role: DashboardRole.ACCOUNTANT,
      status: 'active',
    },
    cfo: {
      id: 'cfo-1',
      organizationId: ORG,
      role: DashboardRole.CFO,
      status: 'active',
    },
  };

  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  const http = () => request(app.getHttpServer() as App);
  const as = (userId: string) => ({ 'x-test-user': userId });

  beforeEach(async () => {
    svc = {
      listMembers: jest.fn().mockResolvedValue([]),
      createInvite: jest.fn().mockResolvedValue({ inviteUrl: 'x' }),
      updateMember: jest.fn().mockResolvedValue({ id: 'acct-1' }),
      createPasswordReset: jest.fn().mockResolvedValue({ resetUrl: 'x' }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DashboardAuthController],
      providers: [
        { provide: DashboardAuthApplicationService, useValue: svc },
        {
          provide: DASHBOARD_USER_REPO,
          useValue: {
            findById: async (id: string) =>
              Object.values(rows).find((r) => r.id === id) ?? null,
          },
        },
        DashboardAdminGuard,
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
            userId: req.headers['x-test-user'],
            role: 'admin',
            organizationId: ORG,
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

  describe.each(['accountant', 'cfo'] as const)('as a %s', (who) => {
    const me = rows[who].id;

    it('can still list members', async () => {
      await http().get('/dashboard-api/auth/members').set(as(me)).expect(200);
      expect(svc.listMembers).toHaveBeenCalledWith(ORG);
    });

    it('cannot invite a new admin', async () => {
      await http()
        .post('/dashboard-api/auth/members')
        .set(as(me))
        .send({ email: 'evil@x.co', displayName: 'Evil', role: 'admin' })
        .expect(403);
      expect(svc.createInvite).not.toHaveBeenCalled();
    });

    it('cannot promote themselves to admin', async () => {
      await http()
        .patch(`/dashboard-api/auth/members/${me}`)
        .set(as(me))
        .send({ role: 'admin' })
        .expect(403);
      expect(svc.updateMember).not.toHaveBeenCalled();
    });

    it("cannot change another member's role or status", async () => {
      await http()
        .patch(`/dashboard-api/auth/members/${rows.admin.id}`)
        .set(as(me))
        .send({ status: 'deactivated' })
        .expect(403);
      expect(svc.updateMember).not.toHaveBeenCalled();
    });

    it("cannot mint a password reset link for the admin's account", async () => {
      await http()
        .post(`/dashboard-api/auth/members/${rows.admin.id}/reset-password`)
        .set(as(me))
        .expect(403);
      expect(svc.createPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('as an admin', () => {
    const me = rows.admin.id;

    it('can invite', async () => {
      await http()
        .post('/dashboard-api/auth/members')
        .set(as(me))
        .send({ email: 'new@x.co', displayName: 'New', role: 'accountant' })
        .expect(201);
      expect(svc.createInvite).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG, role: 'accountant' }),
      );
    });

    it("can change a member's role", async () => {
      await http()
        .patch(`/dashboard-api/auth/members/${rows.accountant.id}`)
        .set(as(me))
        .send({ role: 'cfo' })
        .expect(200);
      expect(svc.updateMember).toHaveBeenCalledWith(
        ORG,
        me,
        rows.accountant.id,
        { role: 'cfo' },
      );
    });

    it('can issue a password reset link', async () => {
      await http()
        .post(
          `/dashboard-api/auth/members/${rows.accountant.id}/reset-password`,
        )
        .set(as(me))
        .expect(201);
      expect(svc.createPasswordReset).toHaveBeenCalledWith(
        ORG,
        rows.accountant.id,
      );
    });
  });
});
