import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogItemOrmEntity } from '../src/catalog/infrastructure/persistence/catalog-item.orm-entity';
import { ItemType } from '../src/shared/domain/enums/item-type.enum';
import { ComplianceOrganizationApplicationService } from '../src/compliance-organization/application/compliance-organization.application.service';
import { STOCK_REPO } from '../src/shared/tokens';
import type { IStockRepository } from '../src/inventory/domain/ports/stock-repository.port';

/**
 * One-off backfill, two passes:
 *
 * 1. Correct `isStockItem` on existing GOODS rows. Before CatalogService.
 *    registerItem() unified the rule to "isStockItem = itemType === GOODS",
 *    Mode A registrations (RegisterCatalogItemDto has no isStockItem field
 *    at all) and strict QuickBooks-Inventory-only pulls left many real
 *    GOODS items stuck at isStockItem=false. Recompute them here to match
 *    the same rule registerItem() now applies on every future write.
 * 2. Seed a 0-qty stock row (default branch) for every item that's now
 *    isStockItem=true, via the same IStockRepository.applyDelta(id,
 *    branchId, 0) the live auto-seed in CatalogService.registerItem() uses.
 *
 * Idempotent/safe to re-run: the isStockItem update is a no-op once
 * corrected, and a 0 delta against an existing stock row is a no-op too. No
 * StockMovement/eTIMS call is ever made by this script.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  const itemRepo = app.get<Repository<CatalogItemOrmEntity>>(
    getRepositoryToken(CatalogItemOrmEntity),
  );
  const organization = app.get(ComplianceOrganizationApplicationService);
  const stockRepo = app.get<IStockRepository>(STOCK_REPO);

  const misflagged = await itemRepo.find({
    where: { itemType: ItemType.GOODS, isStockItem: false },
  });
  if (misflagged.length > 0) {
    console.log(
      `Correcting isStockItem on ${misflagged.length} GOODS item(s) that predate the unified rule:`,
    );
    for (const item of misflagged) {
      console.log(`  FIX FLAG ${item.id} (${item.name})`);
    }
    await itemRepo.update(
      { itemType: ItemType.GOODS, isStockItem: false },
      { isStockItem: true },
    );
    console.log('');
  }

  const items = await itemRepo.find({ where: { isStockItem: true } });
  console.log(`Found ${items.length} stock-tracked catalog item(s).\n`);

  const branchIdByMerchant = new Map<string, string | null>();
  let seeded = 0;
  let alreadyHadRow = 0;
  let skippedNoBranch = 0;
  const errors: Array<{ itemId: string; name: string; error: string }> = [];

  for (const item of items) {
    try {
      let branchId = branchIdByMerchant.get(item.merchantId);
      if (branchId === undefined) {
        const tenant = await organization.getTenantBySync2booksCompanyId(
          item.merchantId,
        );
        const branches = tenant
          ? await organization.listBranches(tenant.id)
          : [];
        branchId = branches[0]?.sync2booksBranchId ?? null;
        branchIdByMerchant.set(item.merchantId, branchId);
      }
      if (!branchId) {
        skippedNoBranch++;
        console.warn(
          `  SKIP     ${item.id} (${item.name}) — merchant ${item.merchantId} has no linked default branch`,
        );
        continue;
      }

      const existing = await stockRepo.getStock(item.id, branchId);
      await stockRepo.applyDelta(item.id, branchId, 0);
      if (existing) {
        alreadyHadRow++;
      } else {
        seeded++;
        console.log(`  SEEDED   ${item.id} (${item.name}) -> branch ${branchId}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ itemId: item.id, name: item.name, error: message });
      console.error(`  ERROR    ${item.id} (${item.name}): ${message}`);
    }
  }

  console.log('\nBackfill summary:');
  console.log(`  Newly seeded:        ${seeded}`);
  console.log(`  Already had a row:   ${alreadyHadRow}`);
  console.log(`  Skipped (no branch): ${skippedNoBranch}`);
  console.log(`  Errors:              ${errors.length}`);

  await app.close();
  if (errors.length > 0) process.exitCode = 1;
}

void main();
