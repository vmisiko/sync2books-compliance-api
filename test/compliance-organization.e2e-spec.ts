import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';

const base = '/compliance-organization';

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

    const tenantRes = await request(http)
      .post(`${base}/tenants`)
      .send({ displayName: 'E2E Dashboard Tenant' })
      .expect(201);

    const tenantId = (tenantRes.body as { id: string }).id;
    expect(tenantId).toBeTruthy();
    expect(
      (tenantRes.body as { sync2booksCompanyId: string | null })
        .sync2booksCompanyId,
    ).toBeNull();

    const branchRes = await request(http)
      .post(`${base}/tenants/${tenantId}/branches`)
      .send({
        displayName: 'E2E Branch',
        kraBhfId: '00',
      })
      .expect(201);

    const branchId = (branchRes.body as { id: string }).id;
    expect(branchId).toBeTruthy();
    expect(
      (branchRes.body as { sync2booksBranchId: string | null })
        .sync2booksBranchId,
    ).toBeNull();

    await request(http)
      .put(`${base}/branches/${branchId}/etims-connection`)
      .send({
        kraPin: 'P012345678X',
        deviceId: 'pending',
        cmcKey: 'pending',
        dvcSrlNo: 'DEVICE-SERIAL-E2E',
        environment: 'SANDBOX',
      })
      .expect(200);

    const initRes = await request(http)
      .post(`${base}/branches/${branchId}/etims-connection/initialize`)
      .send({ dvcSrlNo: 'DEVICE-SERIAL-E2E' })
      .expect(200);

    const conn = initRes.body as { deviceId: string; cmcKey: string };
    expect(conn.deviceId).toContain('stub-dvc');
    expect(conn.cmcKey).toBe('cmc-key-stub-init');

    const getTenant = await request(http)
      .get(`${base}/tenants/${tenantId}`)
      .expect(200);
    expect((getTenant.body as { displayName: string | null }).displayName).toBe(
      'E2E Dashboard Tenant',
    );
  });

  it('upserts tenant by sync2books company id and resolves via GET by-sync2books', async () => {
    const http = app.getHttpServer();
    const extId = `s2b-co-${Date.now()}`;

    await request(http)
      .post(`${base}/tenants`)
      .send({
        sync2booksCompanyId: extId,
        displayName: 'Sync2Books linked',
      })
      .expect(201);

    const found = await request(http)
      .get(`${base}/tenants/by-sync2books/${extId}`)
      .expect(200);

    expect(
      (found.body as { sync2booksCompanyId: string }).sync2booksCompanyId,
    ).toBe(extId);
  });

  it('updates dashboard-only tenant when id is sent on POST /tenants', async () => {
    const http = app.getHttpServer();

    const created = await request(http)
      .post(`${base}/tenants`)
      .send({ displayName: 'Before' })
      .expect(201);

    const id = (created.body as { id: string }).id;

    const updated = await request(http)
      .post(`${base}/tenants`)
      .send({ id, displayName: 'After' })
      .expect(201);

    expect((updated.body as { id: string }).id).toBe(id);
    expect((updated.body as { displayName: string | null }).displayName).toBe(
      'After',
    );
  });
});
