import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, type Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogItemOrmEntity } from '../src/catalog/infrastructure/persistence/catalog-item.orm-entity';
import { ComplianceOrganizationApplicationService } from '../src/compliance-organization/application/compliance-organization.application.service';
import { InventoryStockOrmEntity } from '../src/inventory/infrastructure/persistence/inventory-stock.orm-entity';
import { StockMovementOrmEntity } from '../src/inventory/infrastructure/persistence/stock-movement.orm-entity';
import { STOCK_REPO } from '../src/shared/tokens';
import type { IStockRepository } from '../src/inventory/domain/ports/stock-repository.port';

/**
 * One-off backfill, three passes:
 *
 * 1. Correct `isStockItem` on existing Raw Material / Finished Product rows
 *    (productTypeCode '1'/'2'). Before CatalogService.registerItem() unified
 *    the rule to "isStockItem = computeIsStockItem(productTypeCode)", Mode A
 *    registrations (RegisterCatalogItemDto has no isStockItem field at all)
 *    and strict QuickBooks-Inventory-only pulls left many real goods items
 *    stuck at isStockItem=false. Recompute them here to match the same rule
 *    registerItem() now applies on every future write.
 * 2. Retire stock rows keyed by a *non-canonical* branch id. `inventory_stock`
 *    is keyed by `ComplianceBranch.id`, but this script's own seeding pass and
 *    CatalogService.seedZeroStockRow both used to key by
 *    `sync2booksBranchId` ('00' for most tenants), so an item can carry two
 *    rows for one logical branch -- and InventoryService.syncStockMasterToEtims
 *    reports whichever one the caller's branch id resolved to as KRA's
 *    resident quantity. See the DELETION SAFETY note on
 *    retireNonCanonicalRows() for exactly which rows this will and won't
 *    touch.
 * 3. Seed a 0-qty stock row (default branch, canonical id) for every item
 *    that's now isStockItem=true, via the same IStockRepository.applyDelta(id,
 *    branchId, 0) the live auto-seed in CatalogService.registerItem() uses.
 *
 * DRY RUN BY DEFAULT. Pass `--apply` to actually write:
 *   pnpm backfill:stock-rows            # report only, no writes
 *   pnpm backfill:stock-rows -- --apply # perform passes 1-3
 *
 * Idempotent/safe to re-run: the isStockItem update is a no-op once
 * corrected, pass 2 finds nothing on a second run, and a 0 delta against an
 * existing stock row is a no-op too. No StockMovement/eTIMS call is ever made
 * by this script -- in particular pass 2 does NOT push a corrected rsdQty to
 * KRA. Anything it reports as needing manual attention should be settled by a
 * real reconcile against the ERP, which pushes saveStockMaster on its own.
 */

const APPLY = process.argv.includes('--apply');

type BranchResolution = {
  /** Canonical id (`ComplianceBranch.id`) of the tenant's default branch. */
  defaultBranchId: string | null;
  /** Every branch id this tenant legitimately owns, in canonical form. */
  canonicalIds: Set<string>;
  /** Non-canonical id -> canonical id, for this tenant's branches. */
  aliasToCanonical: Map<string, string>;
};

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  const itemRepo = app.get<Repository<CatalogItemOrmEntity>>(
    getRepositoryToken(CatalogItemOrmEntity),
  );
  const stockRowRepo = app.get<Repository<InventoryStockOrmEntity>>(
    getRepositoryToken(InventoryStockOrmEntity),
  );
  const movementRepo = app.get<Repository<StockMovementOrmEntity>>(
    getRepositoryToken(StockMovementOrmEntity),
  );
  const organization = app.get(ComplianceOrganizationApplicationService);
  const stockRepo = app.get<IStockRepository>(STOCK_REPO);

  console.log(
    APPLY
      ? 'Running in APPLY mode -- rows will be written and deleted.\n'
      : 'Running in DRY RUN mode -- nothing will be written. Re-run with --apply to commit.\n',
  );

  const branchesByMerchant = new Map<string, BranchResolution>();
  const resolveBranches = async (
    merchantId: string,
  ): Promise<BranchResolution> => {
    const cached = branchesByMerchant.get(merchantId);
    if (cached) return cached;
    const tenant =
      await organization.getTenantBySync2booksCompanyId(merchantId);
    const branches = tenant ? await organization.listBranches(tenant.id) : [];
    const resolution: BranchResolution = {
      defaultBranchId: branches[0]?.id ?? null,
      canonicalIds: new Set(branches.map((b) => b.id)),
      aliasToCanonical: new Map(
        branches
          .filter((b) => b.sync2booksBranchId && b.sync2booksBranchId !== b.id)
          .map((b) => [b.sync2booksBranchId as string, b.id]),
      ),
    };
    branchesByMerchant.set(merchantId, resolution);
    return resolution;
  };

  await correctIsStockItemFlags(itemRepo);
  const items = await itemRepo.find({ where: { isStockItem: true } });
  console.log(`Found ${items.length} stock-tracked catalog item(s).\n`);

  await retireNonCanonicalRows({
    items,
    stockRowRepo,
    movementRepo,
    resolveBranches,
  });
  await seedMissingRows({ items, stockRepo, resolveBranches });

  await app.close();
}

/** Pass 1 -- see the module doc comment. */
async function correctIsStockItemFlags(
  itemRepo: Repository<CatalogItemOrmEntity>,
): Promise<void> {
  const misflagged = await itemRepo.find({
    where: { productTypeCode: In(['1', '2']), isStockItem: false },
  });
  if (misflagged.length === 0) return;

  console.log(
    `Pass 1: correcting isStockItem on ${misflagged.length} goods item(s) that predate the unified rule:`,
  );
  for (const item of misflagged) {
    console.log(`  FIX FLAG ${item.id} (${item.name})`);
  }
  if (APPLY) {
    await itemRepo.update(
      { productTypeCode: In(['1', '2']), isStockItem: false },
      { isStockItem: true },
    );
  }
  console.log('');
}

/**
 * Pass 2 -- collapse the '00'-vs-UUID stock-row split onto the canonical
 * branch id.
 *
 * DELETION SAFETY. A non-canonical row is only ever deleted when it is
 * provably an empty artifact of the old seeding bug: quantityOnHand and
 * reservedQuantity both 0, AND no stock_movements rows reference that
 * (itemId, branchId) pair. Nothing is merged, summed, or moved.
 *
 * A non-canonical row with real quantity is NOT touched, because the two rows
 * are two different claims about the *same* physical stock, not two piles to
 * add together -- summing would inflate the quantity this service reports to
 * KRA as `rsdQty`, and a wrong rsdQty is a wrong tax filing. Those get printed
 * as NEEDS RECONCILE and must be settled by an actual reconcile against the
 * ERP (POST /api/stock/reconcile, or the dashboard's Inventory reconcile),
 * which recomputes on-hand from the source of truth and pushes the corrected
 * saveStockMaster to KRA itself.
 */
async function retireNonCanonicalRows(deps: {
  items: CatalogItemOrmEntity[];
  stockRowRepo: Repository<InventoryStockOrmEntity>;
  movementRepo: Repository<StockMovementOrmEntity>;
  resolveBranches: (merchantId: string) => Promise<BranchResolution>;
}): Promise<void> {
  const { items, stockRowRepo, movementRepo, resolveBranches } = deps;
  console.log('Pass 2: stock rows keyed by a non-canonical branch id');

  let deleted = 0;
  let needsReconcile = 0;
  let unknownBranch = 0;

  for (const item of items) {
    const rows = await stockRowRepo.find({ where: { itemId: item.id } });
    if (rows.length === 0) continue;
    const { canonicalIds, aliasToCanonical } = await resolveBranches(
      item.merchantId,
    );

    for (const row of rows) {
      if (canonicalIds.has(row.branchId)) continue;

      const canonical = aliasToCanonical.get(row.branchId);
      if (!canonical) {
        // Not a known alias for this tenant either -- could be a branch that
        // was deleted, or a row that predates the tenant's provisioning.
        // Never guess at that; just surface it.
        unknownBranch++;
        console.warn(
          `  UNKNOWN  ${item.id} branch=${row.branchId} qty=${row.quantityOnHand} — ` +
            `matches no branch of merchant ${item.merchantId}; left in place`,
        );
        continue;
      }

      const movements = await movementRepo.count({
        where: { itemId: item.id, branchId: row.branchId },
      });
      const isEmptyArtifact =
        row.quantityOnHand === 0 &&
        row.reservedQuantity === 0 &&
        movements === 0;

      if (!isEmptyArtifact) {
        needsReconcile++;
        console.warn(
          `  NEEDS RECONCILE ${item.id} (${item.name}) — non-canonical branch ` +
            `${row.branchId} holds qty=${row.quantityOnHand} ` +
            `reserved=${row.reservedQuantity} movements=${movements}. Canonical ` +
            `branch is ${canonical}. Left in place: reconcile this item against ` +
            `its ERP rather than merging two conflicting on-hand claims.`,
        );
        continue;
      }

      deleted++;
      console.log(
        `  ${APPLY ? 'DELETED ' : 'WOULD DELETE'} ${item.id} (${item.name}) — ` +
          `empty seed row on non-canonical branch ${row.branchId} (canonical ${canonical})`,
      );
      if (APPLY) await stockRowRepo.delete({ id: row.id });
    }
  }

  console.log(
    `  ${APPLY ? 'Deleted' : 'Would delete'}: ${deleted}   ` +
      `Needs manual reconcile: ${needsReconcile}   Unresolvable branch: ${unknownBranch}\n`,
  );
}

/** Pass 3 -- see the module doc comment. */
async function seedMissingRows(deps: {
  items: CatalogItemOrmEntity[];
  stockRepo: IStockRepository;
  resolveBranches: (merchantId: string) => Promise<BranchResolution>;
}): Promise<void> {
  const { items, stockRepo, resolveBranches } = deps;
  console.log('Pass 3: seeding 0-qty rows on the canonical default branch');

  let seeded = 0;
  let alreadyHadRow = 0;
  let skippedNoBranch = 0;
  const errors: Array<{ itemId: string; name: string; error: string }> = [];

  for (const item of items) {
    try {
      const { defaultBranchId } = await resolveBranches(item.merchantId);
      if (!defaultBranchId) {
        skippedNoBranch++;
        console.warn(
          `  SKIP     ${item.id} (${item.name}) — merchant ${item.merchantId} has no branch`,
        );
        continue;
      }

      const existing = await stockRepo.getStock(item.id, defaultBranchId);
      if (existing) {
        alreadyHadRow++;
        continue;
      }
      seeded++;
      console.log(
        `  ${APPLY ? 'SEEDED  ' : 'WOULD SEED'} ${item.id} (${item.name}) -> branch ${defaultBranchId}`,
      );
      if (APPLY) await stockRepo.applyDelta(item.id, defaultBranchId, 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ itemId: item.id, name: item.name, error: message });
      console.error(`  ERROR    ${item.id} (${item.name}): ${message}`);
    }
  }

  console.log(
    `  ${APPLY ? 'Seeded' : 'Would seed'}: ${seeded}   Already had a row: ${alreadyHadRow}   ` +
      `Skipped (no branch): ${skippedNoBranch}   Errors: ${errors.length}`,
  );
  if (errors.length > 0) process.exitCode = 1;
}

void main();
