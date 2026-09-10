import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CatalogItemOrmEntity } from '../src/catalog/infrastructure/persistence/catalog-item.orm-entity';
import { computeIsStockItem } from '../src/catalog/domain/entities/catalog-item.entity';
import { ComplianceOrganizationApplicationService } from '../src/compliance-organization/application/compliance-organization.application.service';
import { InventoryStockOrmEntity } from '../src/inventory/infrastructure/persistence/inventory-stock.orm-entity';
import { StockMovementOrmEntity } from '../src/inventory/infrastructure/persistence/stock-movement.orm-entity';
import { STOCK_REPO } from '../src/shared/tokens';
import type { IStockRepository } from '../src/inventory/domain/ports/stock-repository.port';

/**
 * One-off backfill, four passes:
 *
 * 1. Recompute `isStockItem` from the same rule registerItem() applies --
 *    `computeIsStockItem(productTypeCode, stockTracked)`. This corrects two
 *    opposite historical errors at once. Goods stuck at false: Mode A
 *    registrations (RegisterCatalogItemDto has no isStockItem field) and
 *    strict QuickBooks-Inventory-only pulls left many real goods items
 *    unflagged. Non-stock goods stuck at true: `isStockItem` used to be
 *    derived from productTypeCode ALONE, so every QuickBooks NonInventory
 *    item became stock-tracked -- KRA's item-type list has no "non-stock
 *    good", so those are Finished Product ('2') and only `stockTracked` can
 *    say they aren't stocked.
 * 2. Retire stock rows on items pass 1 just turned OFF. A NonInventory item
 *    should hold no `inventory_stock` row at all; the ones it has are
 *    artifacts of seedZeroStockRow having believed it was stocked. Empty
 *    rows are deleted outright; non-empty ones are reported and left, since
 *    a real quantity is not this script's to destroy (see `--purge-nonempty`).
 * 3. Retire stock rows keyed by a *non-canonical* branch id. `inventory_stock`
 *    is keyed by `ComplianceBranch.id`, but this script's own seeding pass and
 *    CatalogService.seedZeroStockRow both used to key by
 *    `sync2booksBranchId` ('00' for most tenants), so an item can carry two
 *    rows for one logical branch -- and InventoryService.syncStockMasterToEtims
 *    reports whichever one the caller's branch id resolved to as KRA's
 *    resident quantity. See the DELETION SAFETY note on
 *    retireNonCanonicalRows() for exactly which rows this will and won't
 *    touch.
 * 4. Seed a 0-qty stock row (default branch, canonical id) for every item
 *    that's now isStockItem=true, via the same IStockRepository.applyDelta(id,
 *    branchId, 0) the live auto-seed in CatalogService.registerItem() uses.
 *
 * RUN A PULL FIRST. `stockTracked` is knowledge only an ERP pull carries, so
 * every row predating it is null and pass 1 will leave those items exactly as
 * they are (null means "nobody ever told us", which is not the same as
 * "not stocked"). Pull items for each tenant, then run this. The pass-1
 * summary reports how many rows are still null so you can tell whether the
 * pull has happened.
 *
 * DRY RUN BY DEFAULT. Pass `--apply` to actually write:
 *   pnpm backfill:stock-rows                            # report only, no writes
 *   pnpm backfill:stock-rows -- --apply                 # perform passes 1-4
 *   pnpm backfill:stock-rows -- --apply --purge-nonempty # also delete pass-2 rows holding stock
 *
 * Idempotent/safe to re-run: the isStockItem update is a no-op once
 * corrected, passes 2 and 3 find nothing on a second run, and a 0 delta
 * against an existing stock row is a no-op too. No StockMovement/eTIMS call is
 * ever made by this script -- in particular it does NOT push a corrected
 * rsdQty to KRA. Anything it reports as needing manual attention should be
 * settled by a real reconcile against the ERP, which pushes saveStockMaster on
 * its own.
 */

const APPLY = process.argv.includes('--apply');
/**
 * Opt-in for pass 2 only: delete a no-longer-stocked item's stock row even
 * when it still holds a quantity. Off by default because that quantity is
 * real data -- it came from an ERP pull or a human adjustment -- and being
 * wrong about the item's type is not licence to destroy it silently.
 */
const PURGE_NONEMPTY = process.argv.includes('--purge-nonempty');

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
  await retireRowsOnNonStockItems({ itemRepo, stockRowRepo, movementRepo });

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

/**
 * Pass 1 -- see the module doc comment.
 *
 * Row by row through `computeIsStockItem` rather than as a pair of bulk
 * UPDATEs, deliberately: the rule now takes two inputs and corrects in both
 * directions, and re-expressing it as SQL predicates is how the two would
 * drift apart. Calling the real function is also the only way this stays
 * right the next time that function changes.
 */
async function correctIsStockItemFlags(
  itemRepo: Repository<CatalogItemOrmEntity>,
): Promise<void> {
  const all = await itemRepo.find();
  const changes = all
    .map((item) => ({
      item,
      want: computeIsStockItem(item.productTypeCode, item.stockTracked),
    }))
    .filter(({ item, want }) => want !== item.isStockItem);

  const stillUnknown = all.filter((i) => i.stockTracked == null).length;
  console.log(
    `Pass 1: isStockItem — ${changes.length} of ${all.length} item(s) disagree with the rule`,
  );
  if (stillUnknown > 0) {
    console.warn(
      `  NOTE: ${stillUnknown} item(s) still have stockTracked = null (no ERP pull has ` +
        `carried the signal yet). Those keep the permissive default and are NOT turned ` +
        `off here. Pull items for their tenants, then re-run.`,
    );
  }

  for (const { item, want } of changes) {
    console.log(
      `  ${want ? 'TURN ON ' : 'TURN OFF'} ${item.id} (${item.name}) — ` +
        `productTypeCode=${item.productTypeCode ?? 'null'} stockTracked=${
          item.stockTracked ?? 'null'
        }`,
    );
    if (APPLY) await itemRepo.update({ id: item.id }, { isStockItem: want });
  }
  console.log('');
}

/**
 * Pass 2 -- see the module doc comment.
 *
 * DELETION SAFETY: only ever touches items that are now `isStockItem = false`,
 * and by default only rows that are provably inert (no quantity, no
 * reservation, no movement history). A row holding stock, or one with a
 * movement ledger behind it, is reported and left alone unless
 * `--purge-nonempty` is passed -- an item being the wrong type is a reason to
 * look at its quantity, not to delete it unseen. StockMovement rows are never
 * deleted either way: they are the audit trail of what was believed at the
 * time.
 */
async function retireRowsOnNonStockItems(deps: {
  itemRepo: Repository<CatalogItemOrmEntity>;
  stockRowRepo: Repository<InventoryStockOrmEntity>;
  movementRepo: Repository<StockMovementOrmEntity>;
}): Promise<void> {
  const { itemRepo, stockRowRepo, movementRepo } = deps;
  console.log('Pass 2: stock rows on items that are no longer stock-tracked');

  const nonStock = await itemRepo.find({ where: { isStockItem: false } });
  let deleted = 0;
  let kept = 0;

  for (const item of nonStock) {
    const rows = await stockRowRepo.find({ where: { itemId: item.id } });
    for (const row of rows) {
      const movements = await movementRepo.count({
        where: { itemId: item.id, branchId: row.branchId },
      });
      const inert =
        row.quantityOnHand === 0 &&
        row.reservedQuantity === 0 &&
        movements === 0;

      if (!inert && !PURGE_NONEMPTY) {
        kept++;
        console.warn(
          `  HOLDS STOCK ${item.id} (${item.name}) — branch ${row.branchId} ` +
            `qty=${row.quantityOnHand} reserved=${row.reservedQuantity} ` +
            `movements=${movements}. Left in place: this item is not stock-tracked ` +
            `any more, so the quantity is stale rather than wrong — check it against ` +
            `the ERP, then re-run with --purge-nonempty to drop it.`,
        );
        continue;
      }

      deleted++;
      console.log(
        `  ${APPLY ? 'DELETED ' : 'WOULD DELETE'} ${item.id} (${item.name}) — ` +
          `branch ${row.branchId} qty=${row.quantityOnHand} movements=${movements}` +
          `${inert ? '' : ' (--purge-nonempty)'}`,
      );
      if (APPLY) await stockRowRepo.delete({ id: row.id });
    }
  }

  console.log(
    `  ${APPLY ? 'Deleted' : 'Would delete'}: ${deleted}   Left in place: ${kept}\n`,
  );
}

/**
 * Pass 3 -- collapse the '00'-vs-UUID stock-row split onto the canonical
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
  console.log('Pass 3: stock rows keyed by a non-canonical branch id');

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

/** Pass 4 -- see the module doc comment. */
async function seedMissingRows(deps: {
  items: CatalogItemOrmEntity[];
  stockRepo: IStockRepository;
  resolveBranches: (merchantId: string) => Promise<BranchResolution>;
}): Promise<void> {
  const { items, stockRepo, resolveBranches } = deps;
  console.log('Pass 4: seeding 0-qty rows on the canonical default branch');

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
