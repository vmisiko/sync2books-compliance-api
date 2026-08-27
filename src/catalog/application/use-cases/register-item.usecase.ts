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
   * OSCU itemTyCd. Omit when the source doesn't unambiguously know it (e.g.
   * an ERP pull that can't tell Raw Material from Finished Product) --
   * NEVER guess a value here. The item registers with productTypeCode null
   * and needsProductType true, blocked from KRA sync until a human
   * explicitly picks one (manually or by editing the pulled item).
   */
  productTypeCode?: string;
  /** OSCU default unit price (dftPrc). */
  unitPrice?: number | null;
  /** OSCU country of origin (orgnNatCd). Defaults to 'KE' when unset. */
  originCountry?: string | null;
  /** The ERP this item was pulled from (e.g. QUICKBOOKS, ODOO) — null for a manually-created item. */
  sourceSystem?: string | null;
}

export interface RegisterItemResult {
  item: CatalogItem;
  created: boolean;
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
  // value a human already confirmed on an existing item.
  const productTypeCode =
    resolution.productTypeCode ?? existing?.productTypeCode ?? null;
  const needsProductType = computeNeedsProductType(productTypeCode);
  // Stock-tracking eligibility is fully determined by productTypeCode --
  // Goods (Raw Material/Finished Product) are stock-tracked, Service is
  // not, and an item still pending a product-type choice is treated as
  // not-yet-stock-tracked until confirmed. Recomputed here on every
  // register/update call, uniformly regardless of source, with no override.
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
      return { item: existing, created: false };
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
    return { item: saved, created: false };
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
  return { item: saved, created: true };
}

function ensureNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ${field} from classification resolver`);
  }
  return value;
}
