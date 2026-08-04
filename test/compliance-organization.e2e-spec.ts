import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { withSync2BooksM2m } from './sync2books-m2m.helper';

const base = '/compliance-organization';
const HDR = 's2b-m2m-e2e-default';

describe('Compliance organization (e2e)', () => {
  let app: INestApplication<App>;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'compliance-org-e2e-'));
    process.env.DATABASE_PATH = join(tmpDir, 'compliance.sqljs.db');
    process.env.NODE_ENV = 'test';

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('provisions dashboard-only tenant → branch → eTIMS shell → initialize (stub OSCU)', async () => {
    const http = app.getHttpServer();

    const tenantRes = await withSync2BooksM2m(
      request(http).post(`${base}/tenants`),
      HDR,
    )
      .send({ displayName: 'E2E Dashboard Tenant' })
      .expect(201);

    const body = tenantRes.body as {
      tenant: { id: string; sync2booksCompanyId: string | null };
      defaultBranchId: string;
      etimsConnection: unknown;
    };
    const tenantId = body.tenant.id;
    expect(tenantId).toBeTruthy();
    expect(body.tenant.sync2booksCompanyId).toBeNull();
    expect(body.defaultBranchId).toBeTruthy();
    expect(body.etimsConnection).toBeNull();

    const listRes = await withSync2BooksM2m(
      request(http).get(`${base}/tenants/${tenantId}/branches`),
      HDR,
    ).expect(200);
    const listed = listRes.body as Array<{
      id: string;
      displayName: string | null;
      sync2booksBranchId: string | null;
    }>;
    expect(listed).toHaveLength(1);
    expect(listed[0].displayName).toBe('Headquarters');

    const branchRes = await withSync2BooksM2m(
      request(http).post(`${base}/tenants/${tenantId}/branches`),
      HDR,
    )
      .send({
        id: listed[0].id,
        displayName: 'E2E Branch',
        kraBhfId: '00',
      })
      .expect(201);

    const branchId = (branchRes.body as { id: string }).id;
    expect(branchId).toBe(listed[0].id);
    expect(
      (branchRes.body as { sync2booksBranchId: string | null })
        .sync2booksBranchId,
    ).toBeNull();

    await withSync2BooksM2m(
      request(http).put(`${base}/branches/${branchId}/etims-connection`),
      HDR,
    )
      .send({
        kraPin: 'P012345678X',
        dvcSrlNo: 'DEVICE-SERIAL-E2E',
        environment: 'SANDBOX',
      })
      .expect(200);

    const initRes = await withSync2BooksM2m(
      request(http).post(
        `${base}/branches/${branchId}/etims-connection/initialize`,
      ),
      HDR,
    ).expect(200);

    const conn = initRes.body as { deviceId: string; cmcKey: string };
    expect(conn.deviceId).toContain('stub-dvc');
    expect(conn.cmcKey).toBe('cmc-key-stub-init');

    const getTenant = await withSync2BooksM2m(
      request(http).get(`${base}/tenants/${tenantId}`),
      HDR,
    ).expect(200);
    expect((getTenant.body as { displayName: string | null }).displayName).toBe(
      'E2E Dashboard Tenant',
    );
  });

  it('upserts tenant by sync2books company id and resolves via GET by-sync2books', async () => {
    const http = app.getHttpServer();
    const extId = `s2b-co-${Date.now()}`;

    await withSync2BooksM2m(request(http).post(`${base}/tenants`), extId)
      .send({
        sync2booksCompanyId: extId,
        displayName: 'Sync2Books linked',
      })
      .expect(201);

    const found = await withSync2BooksM2m(
      request(http).get(`${base}/tenants/by-sync2books/${extId}`),
      extId,
    ).expect(200);

    expect(
      (found.body as { sync2booksCompanyId: string }).sync2booksCompanyId,
    ).toBe(extId);
  });

  it('updates dashboard-only tenant when id is sent on POST /tenants', async () => {
    const http = app.getHttpServer();

    const created = await withSync2BooksM2m(
      request(http).post(`${base}/tenants`),
      HDR,
    )
      .send({ displayName: 'Before' })
      .expect(201);

    const id = (created.body as { tenant: { id: string } }).tenant.id;

    const updated = await withSync2BooksM2m(
      request(http).post(`${base}/tenants`),
      HDR,
    )
      .send({ id, displayName: 'After' })
      .expect(201);

    expect((updated.body as { tenant: { id: string } }).tenant.id).toBe(id);
    expect(
      (updated.body as { tenant: { displayName: string | null } }).tenant
        .displayName,
    ).toBe('After');
  });

  it('creates tenant, default branch, and eTIMS shell in one POST when kraPin is sent', async () => {
    const http = app.getHttpServer();

    const res = await withSync2BooksM2m(
      request(http).post(`${base}/tenants`),
      HDR,
    )
      .send({
        displayName: 'One-shot business',
        kraPin: 'A123456789B',
        isLiveBusiness: false,
      })
      .expect(201);

    const payload = res.body as {
      tenant: { id: string; displayName: string | null };
      defaultBranchId: string;
      etimsConnection: { kraPin: string; environment: string } | null;
    };

    expect(payload.tenant.displayName).toBe('One-shot business');
    expect(payload.defaultBranchId).toBeTruthy();
    expect(payload.etimsConnection).toBeTruthy();
    expect(payload.etimsConnection?.kraPin).toBe('A123456789B');
    expect(payload.etimsConnection?.environment).toBe('SANDBOX');

    const listRes = await withSync2BooksM2m(
      request(http).get(`${base}/tenants/${payload.tenant.id}/branches`),
      HDR,
    ).expect(200);
    const listed = listRes.body as Array<{ id: string; displayName: string }>;
    expect(listed.some((b) => b.id === payload.defaultBranchId)).toBe(true);
  });
});
