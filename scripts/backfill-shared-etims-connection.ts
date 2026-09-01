import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ComplianceOrganizationApplicationService } from '../src/compliance-organization/application/compliance-organization.application.service';
import { ComplianceBranchOrmEntity } from '../src/compliance-organization/infrastructure/persistence/compliance-branch.orm-entity';
import { ComplianceEtimsConnectionOrmEntity } from '../src/compliance-organization/infrastructure/persistence/compliance-etims-connection.orm-entity';
import { ComplianceTenantOrmEntity } from '../src/compliance-organization/infrastructure/persistence/compliance-tenant.orm-entity';
import { ConnectionEnvironment } from '../src/shared/domain/enums/connection-environment.enum';

/**
 * One-off backfill for tenants created before `149f65e` ("Default new sandbox
 * tenants to a shared, already-initialized eTIMS connection", 2026-08-29
 * 18:28) -- that commit made `upsertTenant` auto-provision a branch's eTIMS
 * connection from the shared sandbox credentials (ETIMS_SANDBOX_SHARED_*)
 * when no explicit kraPin is given, but only for *new* tenants going
 * forward. Anything created before it (or in the few seconds before the
 * feature actually went live) never got a connection row at all, and every
 * KRA-touching action for them (item sync, sales, stock) throws/fails with
 * "No active eTIMS connection" -- see the pkg-field-fix session for the 500
 * this caused when that throw wasn't yet caught gracefully.
 *
 * Finds every branch with zero `compliance_etims_connections` row and
 * applies the same shared credentials `upsertTenant` would have used, via
 * the real `ComplianceOrganizationApplicationService.upsertEtimsConnection`
 * (not a raw insert) -- so it's the exact same code path/entity shape,
 * flagged ACTIVE.
 *
 * Assumes every currently-unconnected tenant is a SANDBOX/test fixture (this
 * script is only meant for local dev environments seeded with test
 * businesses) -- there is no persisted "intended environment" on a tenant
 * row to check, since environment has only ever lived on the connection
 * itself. Idempotent: upsertEtimsConnection is a keyed upsert, so re-running
 * against an already-connected branch is a no-op (skipped up front).
 */
async function main(): Promise<void> {
  const kraPin = process.env.ETIMS_SANDBOX_SHARED_KRA_PIN?.trim();
  const dvcSrlNo = process.env.ETIMS_SANDBOX_SHARED_DVC_SRL_NO?.trim();
  const deviceId = process.env.ETIMS_SANDBOX_SHARED_DEVICE_ID?.trim();
  const cmcKey = process.env.ETIMS_SANDBOX_SHARED_CMC_KEY?.trim();
  if (!kraPin || !dvcSrlNo || !deviceId || !cmcKey) {
    console.error(
      'ETIMS_SANDBOX_SHARED_KRA_PIN/_DVC_SRL_NO/_DEVICE_ID/_CMC_KEY must all be set -- aborting.',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  const branchRepo = app.get<Repository<ComplianceBranchOrmEntity>>(
    getRepositoryToken(ComplianceBranchOrmEntity),
  );
  const tenantRepo = app.get<Repository<ComplianceTenantOrmEntity>>(
    getRepositoryToken(ComplianceTenantOrmEntity),
  );
  const connectionRepo = app.get<Repository<ComplianceEtimsConnectionOrmEntity>>(
    getRepositoryToken(ComplianceEtimsConnectionOrmEntity),
  );
  const organization = app.get(ComplianceOrganizationApplicationService);

  const allBranches = await branchRepo.find();
  const connectedBranchIds = new Set(
    (await connectionRepo.find({ relations: ['branch'] })).map(
      (c) => c.branch.id,
    ),
  );
  const unconnected = allBranches.filter((b) => !connectedBranchIds.has(b.id));

  console.log(
    `Found ${unconnected.length} branch(es) with no eTIMS connection.\n`,
  );

  let connected = 0;
  const errors: Array<{ branchId: string; error: string }> = [];

  for (const branch of unconnected) {
    const tenant = await tenantRepo.findOne({ where: { id: branch.tenantId } });
    const label = `${tenant?.displayName ?? '(unknown tenant)'} / ${branch.displayName ?? branch.id}`;
    try {
      if (!branch.kraBhfId) {
        console.warn(`  SKIP     ${label} — branch has no kraBhfId set`);
        continue;
      }
      await organization.upsertEtimsConnection({
        complianceBranchId: branch.id,
        kraPin,
        dvcSrlNo,
        deviceId,
        cmcKey,
        environment: ConnectionEnvironment.SANDBOX,
      });
      connected++;
      console.log(`  CONNECTED ${label} (branch ${branch.id})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ branchId: branch.id, error: message });
      console.error(`  ERROR    ${label} (branch ${branch.id}): ${message}`);
    }
  }

  console.log('\nBackfill summary:');
  console.log(`  Newly connected: ${connected}`);
  console.log(`  Errors:          ${errors.length}`);

  await app.close();
  if (errors.length > 0) process.exitCode = 1;
}

void main();
