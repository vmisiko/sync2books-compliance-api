import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Not, type Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { MainApiConnectionOrmEntity } from '../src/integration/main-api-pull/infrastructure/persistence/main-api-connection.orm-entity';
import { getGlobalMainApiCredentials } from '../src/shared/config/main-api-app-credentials';

/**
 * One-off cutover: every existing per-tenant `MainApiConnection` row still
 * points at its own (per-tenant or per-organization) Main API Application.
 * Overwrites mainApiApplicationId/mainApiApiKey on every row with the one
 * shared Application configured via MAIN_API_APPLICATION_ID/MAIN_API_API_KEY.
 *
 * Safe to re-run (idempotent) — rows already on the shared credentials are
 * simply skipped. Nothing else on the row changes: mainApiCompanyId,
 * webhookEndpointId/Secret, and integrations all keep working unchanged,
 * since nest-sync-2-books-api's company/connection lookups aren't scoped to
 * the calling Application (verified against company.controller.ts /
 * company.service.ts — see the plan doc for the trace).
 */
async function main(): Promise<void> {
  const { mainApiApplicationId, mainApiApiKey } = getGlobalMainApiCredentials();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  const connectionRepo = app.get<Repository<MainApiConnectionOrmEntity>>(
    getRepositoryToken(MainApiConnectionOrmEntity),
  );

  const stale = await connectionRepo.find({
    where: { mainApiApplicationId: Not(mainApiApplicationId) },
  });

  console.log(
    `Found ${stale.length} tenant(s) still on their own Main API Application.`,
  );
  for (const row of stale) {
    console.log(
      `  ${row.complianceTenantId} — was ${row.mainApiApplicationId}, integrations: ${Object.keys(row.integrations ?? {}).join(', ') || 'none'}`,
    );
  }

  if (stale.length > 0) {
    await connectionRepo.update(
      { mainApiApplicationId: Not(mainApiApplicationId) },
      { mainApiApplicationId, mainApiApiKey },
    );
  }

  console.log(`\nMigrated ${stale.length} row(s) onto the shared Application.`);

  await app.close();
}

void main();
