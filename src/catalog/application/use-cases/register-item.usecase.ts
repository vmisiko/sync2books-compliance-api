import { randomUUID } from 'crypto';
import {
  computeIsStockItem,
  computeNeedsClassificationMapping,
  computeNeedsClassificationReview,
  computeNeedsProductType,
  CatalogItem,
} from '../../domain/entities/catalog-item.entity';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import type { ICatalogItemRepository } from '../../domain/ports/item-repository.port';
import type { IClassificationResolver } from '../../domain/ports/classification-resolver.port';

export interface RegisterItemInput {
  merchantId: string;
  /** Omit/null for a manually-created item with no ERP source — always inserts rather than upserting. */
  externalId?: string | null;
  name: string;
  sku?: string | null;
  taxCategory: TaxCategory;
  classificationCode?: string;
  /** This item's own KRA quantity unit code — resolved per item, no category fallback. */
  unitCode?: string;
  /** This item's own KRA packaging unit code — resolved per item, no category fallback. */
  packagingUnitCode?: string;
  taxTyCd?: string;
  /**
   * OSCU itemTyCd, asserted -- it overrides whatever the existing row has, so
   * only pass it when the source unambiguously knows it (e.g. a Service
   * signal from the ERP). An ERP pull can't tell Raw Material from Finished
   * Product, so it must NOT guess between them here; it passes
   * defaultProductTypeCode below instead.
   */
  productTypeCode?: string;
  /**
   * Weak default for productTypeCode, used ONLY when the item has no product
   * type from any stronger source -- not from `productTypeCode` above, and not
   * already set on the existing row by a human. An ERP pull passes '2'
   * (Finished Product) here so a pulled good registers usable instead of
   * landing PENDING on needsProductType; passing it as `productTypeCode`
   * instead would make every routine re-pull overwrite a Raw Material ('1')
   * or Service ('3') someone had explicitly corrected it to.
   */
  defaultProductTypeCode?: string;
  /** OSCU default unit price (dftPrc). */
  unitPrice?: number | null;
  /** OSCU country of origin (orgnNatCd). Defaults to 'KE' when unset. */
  originCountry?: string | null;
  /** The ERP this item was pulled from (e.g. QUICKBOOKS, ODOO) — null for a manually-created item. */
  sourceSystem?: string | null;
  /**
   * The ERP's own stock-tracked signal (Inventory vs NonInventory) -- see
   * CatalogItem.stockTracked. Only a pull can supply this; every other
   * caller omits it, and an omission preserves whatever the row already
   * holds rather than resetting it. Same existing-preferring rule as
   * classificationCode/productTypeCode, and for the same reason: a write
   * path that cannot know a value must never erase it.
   */
  stockTracked?: boolean | null;
}

export interface RegisterItemResult {
  item: CatalogItem;
  created: boolean;
  /**
   * True when this call is the first time the ERP has ever claimed to track
   * this item's quantity -- `stockTracked` moved from null/false to true on
   * an item that already existed.
   *
   * The moment matters because it is when a merchant upgrades their
   * QuickBooks plan (Essentials and Simple Start have no inventory feature),
   * or converts an item to Inventory. Until then the item's stock was kept
   * by hand; from now on the ERP has an opinion about it, and the two can
   * disagree wildly -- a freshly converted Inventory item typically starts at
   * 0. Reported here so the pull can notice rather than reconcile straight
   * over the top of hand-kept stock. Always false for a brand-new item:
   * there is no prior quantity to lose.
   */
  erpBeganTrackingStock: boolean;
}

/**
 * Register or update a catalog item.
 * Resolves classification/unit via mapping if not provided.
 */
export async function registerItem(
  input: RegisterItemInput,
  itemRepo: ICatalogItemRepository,
  classificationResolver: IClassificationResolver,
): Promise<RegisterItemResult> {
  // A manually-created item has no externalId -- there's nothing to upsert
  // against, so it always inserts as a brand-new row (guards against a null
  // externalId ever matching another manual item's row).
  const existing = input.externalId
    ? await itemRepo.findByMerchantAndExternalId(
        input.merchantId,
        input.externalId,
        input.sourceSystem ?? null,
      )
    : null;

  const resolution = await classificationResolver.resolveClassification({
    merchantId: input.merchantId,
    classificationCode: input.classificationCode,
    unitCode: input.unitCode,
    packagingUnitCode: input.packagingUnitCode,
    taxTyCd: input.taxTyCd,
    productTypeCode: input.productTypeCode,
    internalTaxCategory: input.taxCategory,
  });

  // Unlike taxTyCd below, these four are allowed to come back unresolved
  // (null) -- resolveClassification never throws for them. Critically: when
  // updating an EXISTING item, an unresolved field must fall back to
  // existing.X, never to '' -- an ERP pull supplies no override for these
  // fields on every single call (classification/packaging/product-type are
  // never ERP-known; quantity unit only via whatever the caller looked up),
  // so without this fallback, every routine re-pull would silently blank
  // out whatever a human had already set, including on an already-
  // REGISTERED item (confirmed happening live 2026-08-27 -- a re-pull
  // wiped 5 KRA-registered items back to blank/PENDING because their
  // resolution came back null and this used to fall back to '' instead of
  // the existing value). '' (not null) is still the right sentinel for
  // classification/unit/packaging on a BRAND NEW item -- see
  // CatalogItem.classificationCode's doc comment -- there's simply no
  // existing value to prefer yet.
  const classificationCode =
    resolution.classificationCode ?? existing?.classificationCode ?? '';
  const unitCode = resolution.unitCode ?? existing?.unitCode ?? '';
  const packagingUnitCode =
    resolution.packagingUnitCode ?? existing?.packagingUnitCode ?? '';
  const needsClassificationMapping = computeNeedsClassificationMapping(
    classificationCode,
    unitCode,
    packagingUnitCode,
  );
  const taxTyCd = ensureNonEmptyString(resolution.taxTyCd, 'taxTyCd');
  // Same existing-preferring fallback as above -- an ERP pull can only ever
  // supply a genuinely more-confident productTypeCode (e.g. a fresh
  // Service signal); when it comes back null, that must never erase a
  // value a human already confirmed on an existing item. Only once both are
  // exhausted does defaultProductTypeCode apply, which is exactly why it's a
  // separate input from productTypeCode -- see its doc comment.
  const productTypeCode =
    resolution.productTypeCode ??
    existing?.productTypeCode ??
    input.defaultProductTypeCode ??
    null;
  const needsProductType = computeNeedsProductType(productTypeCode);
  // Same existing-preferring fallback as classificationCode/productTypeCode
  // above: only a pull knows this, so every other write path omits it and
  // must leave what the pull already established alone.
  const stockTracked = input.stockTracked ?? existing?.stockTracked ?? null;
  const erpBeganTrackingStock =
    existing != null && stockTracked === true && existing.stockTracked !== true;
  // Deliberately NOT a function of stockTracked -- see
  // CatalogItem.isStockItem. What the ERP inventory-tracks and what KRA
  // needs a stock master for are different questions.
  const isStockItem = computeIsStockItem(productTypeCode);
  const now = new Date();

  if (existing) {
    const nextSku = input.sku ?? existing.sku;
    const nextUnitPrice = input.unitPrice ?? existing.unitPrice;
    const nextOriginCountry = input.originCountry ?? existing.originCountry ?? 'KE';
    const nextSourceSystem = input.sourceSystem ?? existing.sourceSystem;
    const changed =
      input.name !== existing.name ||
      nextSku !== existing.sku ||
      input.taxCategory !== existing.taxCategory ||
      classificationCode !== existing.classificationCode ||
      unitCode !== existing.unitCode ||
      packagingUnitCode !== existing.packagingUnitCode ||
      taxTyCd !== existing.taxTyCd ||
      productTypeCode !== existing.productTypeCode ||
      nextUnitPrice !== existing.unitPrice ||
      nextOriginCountry !== existing.originCountry ||
      nextSourceSystem !== existing.sourceSystem ||
      isStockItem !== existing.isStockItem;

    // stockTracked deliberately NOT in `changed`: it never appears in a
    // saveItem payload -- it records what the ERP does with quantities, which
    // KRA never sees -- so a change to it is not a reason to resync. Putting
    // it there re-staged every ERP item as PENDING on the first pull after
    // deploy and wiped its sync history, which is precisely the incident the
    // comment below describes. It still has to be *persisted*, though, and
    // the early return would drop it; hence the metadata-only branch.
    const metadataChanged = stockTracked !== existing.stockTracked;

    // A re-pull (main API's own item cache refreshing, or a human clicking
    // "Pull from ERP" again) reprocesses every item every time, including
    // ones that already registered successfully with KRA. Previously this
    // branch unconditionally reset registrationStatus to PENDING and wiped
    // lastSyncedAt/lastSyncResultCd -- meaning simply re-pulling (for any
    // reason, e.g. to pick up one new item) silently discarded every already-
    // REGISTERED item's sync history and staged it for a pointless resync,
    // risking a real, unnecessary KRA saveItem call reusing the same itemCd
    // the next time someone clicks Sync. Only actually reset when something
    // KRA-relevant changed. A FAILED or already-PENDING item still gets
    // re-staged unconditionally below -- re-pulling has always been the way
    // to retry those, and that's preserved.
    if (!changed && existing.registrationStatus === 'REGISTERED') {
      if (!metadataChanged) {
        return { item: existing, created: false, erpBeganTrackingStock };
      }
      // Record the new signal and nothing else: registrationStatus,
      // lastSyncedAt, the sync result and `version` all stay exactly as they
      // were, because as far as KRA is concerned nothing happened.
      const saved = await itemRepo.save({
        ...existing,
        stockTracked,
        updatedAt: now,
      });
      return { item: saved, created: false, erpBeganTrackingStock };
    }

    const updated: CatalogItem = {
      ...existing,
      name: input.name,
      sku: nextSku,
      taxCategory: input.taxCategory,
      classificationCode,
      classificationMethod: resolution.method,
      needsClassificationReview: computeNeedsClassificationReview(resolution.method),
      unitCode,
      packagingUnitCode,
      needsClassificationMapping,
      taxTyCd,
      productTypeCode,
      needsProductType,
      unitPrice: nextUnitPrice,
      originCountry: nextOriginCountry,
      sourceSystem: nextSourceSystem,
      stockTracked,
      isStockItem,
      // Any change requires a resync to eTIMS (same itemCd can be reused).
      registrationStatus: 'PENDING',
      lastSyncedAt: null,
      lastSyncResultCd: null,
      lastSyncResultMsg: null,
      lastSyncAttemptAt: null,
      version: existing.version + 1,
      updatedAt: now,
    };
    const saved = await itemRepo.save(updated);
    return { item: saved, created: false, erpBeganTrackingStock };
  }

  const newItem: CatalogItem = {
    // Stable id so other systems (sales, ERP sync) can reference it reliably.
    // Manual entries (no externalId) get a random suffix instead, since
    // there's no ERP-provided id to key off of. sourceSystem is folded in
    // here (not just used for the `existing` lookup above) because two ERPs
    // routinely assign the same small numeric externalId to unrelated
    // products for the same merchant -- without it, this id would collide
    // with an already-registered item from a different ERP and silently
    // overwrite it on insert instead of creating a distinct row. Existing
    // rows created before this fix keep their old (unscoped) id -- this
    // only affects newly-inserted rows going forward.
    id: input.externalId
      ? `item-${input.merchantId}-${input.sourceSystem ?? 'legacy'}-${input.externalId}`
      : `item-${input.merchantId}-manual-${randomUUID()}`,
    merchantId: input.merchantId,
    externalId: input.externalId ?? null,
    name: input.name,
    sku: input.sku ?? null,
    taxCategory: input.taxCategory,
    classificationCode,
    classificationMethod: resolution.method,
    needsClassificationReview: computeNeedsClassificationReview(resolution.method),
    unitCode,
    packagingUnitCode,
    needsClassificationMapping,
    taxTyCd,
    productTypeCode,
    needsProductType,
    unitPrice: input.unitPrice ?? null,
    originCountry: input.originCountry ?? 'KE',
    sourceSystem: input.sourceSystem ?? null,
    stockTracked,
    isStockItem,
    registrationStatus: 'PENDING',
    etimsItemCode: null,
    lastSyncResultCd: null,
    lastSyncResultMsg: null,
    lastSyncAttemptAt: null,
    version: 1,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const saved = await itemRepo.save(newItem);
  return { item: saved, created: true, erpBeganTrackingStock: false };
}

function ensureNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ${field} from classification resolver`);
  }
  return value;
}
