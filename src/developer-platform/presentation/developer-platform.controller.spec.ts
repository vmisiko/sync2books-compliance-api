import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { DashboardAdminGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-admin.guard';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import { DashboardRole } from '../../shared/domain/enums/dashboard-role.enum';
import { DASHBOARD_USER_REPO } from '../../shared/tokens';
import { DeveloperPlatformApplicationService } from '../application/developer-platform.application.service';
import { DeveloperPlatformController } from './developer-platform.controller';

/**
 * Route-level proof that API-key management is admin-only. The real controller
 * runs behind the real DashboardAdminGuard; only identity (the JWT guard), the
 * user rows and the service underneath are faked, so a "not called" assertion
 * means the handler never ran.
 *
 * The JWT guard stub always claims `role: 'admin'` -- the admin guard must
 * decide from the user row, never from the token's role claim.
 */
describe('dashboard-api/developer -- admin-only key management', () => {
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

  // method, path, the service call the handler makes
  const routes: Array<[string, string, string]> = [
    ['get', '/dashboard-api/developer/applications', 'listApplications'],
    ['post', '/dashboard-api/developer/applications', 'createApplication'],
    [
      'patch',
      '/dashboard-api/developer/applications/app-1',
      'updateApplication',
    ],
    ['get', '/dashboard-api/developer/applications/app-1/keys', 'listKeys'],
    ['post', '/dashboard-api/developer/applications/app-1/keys', 'createKey'],
    ['post', '/dashboard-api/developer/keys/key-1/rotate', 'rotateKey'],
    ['post', '/dashboard-api/developer/keys/key-1/revoke', 'revokeKey'],
  ];

  let app: INestApplication;
  let svc: Record<string, jest.Mock>;

  const http = () => request(app.getHttpServer() as App);
  const call = (method: string, path: string, userId: string) =>
    (http() as unknown as Record<string, (p: string) => request.Test>)
      [method](path)
      .set({ 'x-test-user': userId })
      .send({});

  beforeEach(async () => {
    svc = Object.fromEntries(
      routes.map(([, , fn]) => [fn, jest.fn().mockResolvedValue([])]),
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [DeveloperPlatformController],
      providers: [
        { provide: DeveloperPlatformApplicationService, useValue: svc },
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
    it.each(routes)('%s %s is forbidden', async (method, path, fn) => {
      await call(method, path, rows[who].id).expect(403);
      expect(svc[fn]).not.toHaveBeenCalled();
    });
  });

  describe('as an admin', () => {
    it.each(routes)('%s %s reaches the handler', async (method, path, fn) => {
      await call(method, path, rows.admin.id);
      expect(svc[fn]).toHaveBeenCalled();
    });
  });
});
