import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

/**
 * Catalog item - registered goods/services.
 * Versioning is critical for audit (document lines snapshot at creation time).
 */
export interface CatalogItem {
  id: string;
  merchantId: string;
  /** Null for items created manually in the dashboard (never pulled from an ERP). */
  externalId: string | null;
  name: string;
  sku: string | null;
  taxCategory: TaxCategory;
  /**
   * OSCU item classification code (itemClsCd). Empty string ('') -- never
   * null, unlike productTypeCode -- means classification resolution found
   * no mapping at all for this item (see ClassificationMethod's
   * 'UNRESOLVED'). Kept as a plain string (not string | null) deliberately:
   * ComplianceItem/EtimsInvoicePayload and everything downstream of
   * prepareDocument already assume a non-nullable string here, and by the
   * time an item can reach those layers it must have a real etimsItemCode,
   * which sync-items.usecase.ts refuses to assign while this is ''. See
   * needsClassificationMapping.
   */
  classificationCode: string;
  /** OSCU unit of quantity code (qtyUnitCd). '' means unresolved -- see classificationCode. */
  unitCode: string;
  /** OSCU packaging unit code (pkgUnitCd). '' means unresolved -- see classificationCode. */
  packagingUnitCode: string;
  /** OSCU tax type code (taxTyCd) */
  taxTyCd: string;
  /**
   * OSCU product type code (itemTyCd, Code Classification 24: '1' Raw
   * Material, '2' Finished Product, '3' Service) -- required by KRA on
   * saveItem and embedded as a validated component of itemCd itself, but
   * NEVER guessed by this system. Null means the merchant hasn't chosen one
   * yet (see needsProductType) -- an ERP pull can only set this when the
   * source unambiguously says "service" (mapped to '3'); it can never tell
   * Raw Material from Finished Product, so goods always land here null
   * until a human picks one, same as a manual entry with nothing selected.
   * This is the single source of truth for what kind of item this is --
   * ItemType (GOODS/SERVICE) is derived FROM this, never the reverse; see
   * deriveItemType below.
   */
  productTypeCode: string | null;
  /**
   * Derived from productTypeCode: true when it's null, i.e. nobody has
   * confirmed this item's KRA product type yet. Same shape as
   * needsClassificationReview, but this one BLOCKS KRA sync entirely
   * (saveItem's itemTyCd is required and can't be fabricated) rather than
   * just flagging for later cleanup -- see sync-items.usecase.ts's
   * eligibility filter.
   */
  needsProductType: boolean;
  /**
   * True when classificationCode, unitCode, or packagingUnitCode is ''
   * (unresolved) -- same "blocks KRA sync until a human fixes it" role as
   * needsProductType, just for the three fields resolveClassification
   * resolves instead of the one the caller must supply directly. Unlike
   * needsClassificationReview below (a weak-but-present match), this means
   * there is genuinely nothing to submit yet. See sync-items.usecase.ts's
   * eligibility filter, which refuses to sync while this is true.
   */
  needsClassificationMapping: boolean;
  /**
   * Which classification-resolver strategy actually matched
   * classificationCode -- see ClassificationMethod. Null for rows written
   * before this field existed. Recomputed on every register/update call,
   * same as isStockItem.
   */
  classificationMethod: string | null;
  /**
   * Derived from classificationMethod: true when the match was a weak guess
   * (NAME_CONTAINS fuzzy match, or the merchant's DEFAULT placeholder) or the
   * item predates this field (null) -- surfaced by GET /dashboard-api/items
   * so the dashboard can flag which pulled items actually need a human to
   * review/correct their classification. False for a confident match
   * (EXTERNAL_ID/SKU) or an EXPLICIT caller-supplied code.
   */
  needsClassificationReview: boolean;
  /** OSCU default unit price (dftPrc). Null when unknown (e.g. dropped/unset ERP source). */
  unitPrice: number | null;
  /** OSCU country of origin (orgnNatCd). Defaults to 'KE' when unset. */
  originCountry: string | null;
  /**
   * The ERP this item was pulled from (e.g. QUICKBOOKS, ODOO,
   * MICROSOFT_DYNAMICS_365_BUSINESS_CENTRAL — see SourceSystem enum), or
   * null for a manually-created item / an item pulled before this field
   * existed.
   */
  sourceSystem: string | null;
  /**
   * Whether the ERP maintains a quantity for this item -- QuickBooks
   * Inventory vs NonInventory, Odoo `is_storable`, Xero
   * `IsTrackedAsInventory`, all normalised to one vocabulary by the main API
   * (see MainApiStandardizedItemType). Null means nobody has ever told us: a
   * manually-created item, or a pull predating this field.
   *
   * INFORMATION, NOT A DECISION. It deliberately does NOT feed
   * {@link isStockItem} -- see that field for why the two are different
   * questions. What it is good for is explaining an item whose stock never
   * moves on its own: `false` means the ERP has no `qtyOnHand` to give, so
   * reconcile can never maintain this item and its stock only ever changes
   * by manual adjustment. That is a real and confusing situation to be in
   * without a field that says so.
   *
   * Persisted rather than recomputed per call because only a pull ever knows
   * it. Every other write path -- editing an item in Item Sync, registering
   * a purchase line, a Mode A registration -- has no ERP contact, and
   * DashboardItemsApplicationService.updateItem re-registers an ERP item
   * with `existing.*`, so a non-persisted signal would be lost on the first
   * edit.
   */
  stockTracked: boolean | null;
  /**
   * Whether KRA requires a stock master for this item (insertStockIO,
   * saveStockMaster, a seeded stock row).
   *
   * Derived from productTypeCode alone, on every register/update, with no
   * override -- see computeIsStockItem.
   *
   * It is NOT the ERP's Inventory-vs-NonInventory flag, however similar the
   * two sound. That was tried and reverted on 2026-09-10 against live data:
   * whether a business inventory-tracks something in QuickBooks is an
   * accounting choice (real inventory items need an asset account and an
   * inventory start date, so plenty of merchants simply don't), while KRA's
   * rule is about the goods themselves -- sell a Good with no stock master
   * and sendSalesTransaction is rejected with "Item <itemCd> does not exist
   * in your stock master". Deriving this from `stockTracked` un-stocked four
   * genuine QuickBooks goods on the dev tenant, including the very item that
   * rejection was first traced on.
   *
   * So: `stockTracked` records what the ERP does; this records what KRA
   * needs. Keep them apart.
   */
  isStockItem: boolean;
  /**
   * Set when this row was deleted from the catalog as a same-named duplicate
   * (DashboardItemsApplicationService.deleteDuplicateItem). Deleted rows drop
   * out of every merchant-wide lookup -- lists, sync-all, invoice/purchase
   * matching -- but findById still returns them, because sale lines and
   * drafts reference items by id. Their KRA registration is untouched: OSCU
   * has no way to unregister an itemCd, and the itemCd sequence never reuses
   * one. A pull that meets a deleted row leaves it deleted rather than
   * reviving it (see registerItem). Optional so literals predating the field
   * still type-check; absent reads the same as null.
   */
  deletedAt?: Date | null;
  registrationStatus: 'PENDING' | 'REGISTERED' | 'FAILED';
  /**
   * The eTIMS/OSCU item code (`itemCd`) assigned/managed by this system.
   * This is what must be used for sales and stock payloads.
   */
  etimsItemCode: string | null;
  /** Last attempt result code/message from OSCU, if available. */
  lastSyncResultCd: string | null;
  lastSyncResultMsg: string | null;
  /** Last sync attempt timestamp (success or failure). */
  lastSyncAttemptAt: Date | null;
  version: number;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * classificationMethod values that reflect a weak/unconfirmed match --
 * NAME_CONTAINS is a fuzzy ILike guess, DEFAULT is the merchant's generic
 * placeholder row. Null (no recorded method -- either a row written before
 * classificationMethod existed, or resolution failed to record one) is
 * treated the same way, since there's no confidence to trust either.
 * EXTERNAL_ID/SKU are exact-identifier matches, and EXPLICIT means the code
 * was supplied directly by the caller (a manual item's own form field, or an
 * already-approved mapping) -- none of those three need a review flag.
 *
 * Single source of truth for this derivation -- used both when constructing
 * a brand-new CatalogItem (register-item.usecase.ts) and when mapping a
 * persisted row back to the domain shape (catalog-item-typeorm.repository.ts),
 * so the flag can never drift between the two paths.
 */
const WEAK_CLASSIFICATION_METHODS = new Set([
  'NAME_CONTAINS',
  'DEFAULT',
  'UNRESOLVED',
]);

export function computeNeedsClassificationReview(
  classificationMethod: string | null,
): boolean {
  return (
    classificationMethod === null ||
    WEAK_CLASSIFICATION_METHODS.has(classificationMethod)
  );
}

/**
 * Single source of truth for needsClassificationMapping -- true when any of
 * the three fields resolveClassification is responsible for filling in
 * came back unresolved ('' -- see CatalogItem.classificationCode's doc
 * comment). Used identically by register-item.usecase.ts,
 * update-manual-item.usecase.ts, and catalog-item-typeorm.repository.ts's
 * read path, same convention as computeNeedsProductType.
 */
export function computeNeedsClassificationMapping(
  classificationCode: string,
  unitCode: string,
  packagingUnitCode: string,
): boolean {
  return (
    classificationCode === '' || unitCode === '' || packagingUnitCode === ''
  );
}

/**
 * productTypeCode is the single source of truth for what kind of item this
 * is -- these three functions are the only place that's allowed to derive
 * anything from it, so ItemType/isStockItem/needsProductType can never
 * drift out of sync with it or with each other. Used identically by
 * register-item.usecase.ts, update-manual-item.usecase.ts, and
 * catalog-item-typeorm.repository.ts's read path.
 */
export function deriveItemType(
  productTypeCode: string | null,
): ItemType | null {
  if (productTypeCode === null) return null;
  return productTypeCode === '3' ? ItemType.SERVICE : ItemType.GOODS;
}

/**
 * A Service (itemTyCd '3') has no KRA stock master; everything else does.
 *
 * Single-input on purpose. It briefly also took the ERP's `stockTracked`
 * signal, and that was wrong -- see CatalogItem.isStockItem for the incident.
 * Leaving the parameter out is what stops the two from being re-coupled by
 * someone reading only the field names.
 *
 * A null productTypeCode (nobody has chosen one yet) resolves to true, the
 * permissive answer: a stock row on an item that turns out not to need one is
 * inert, whereas a missing one gets a sale rejected. The doc comment on the
 * field used to claim null -> false; the code never did that, and true is the
 * behaviour worth keeping.
 */
/**
 * The name two catalog rows are compared on to decide they're duplicates --
 * trimmed, whitespace collapsed, case-folded. Must stay identical to the
 * dashboard's normalizeItemName (catalogDuplicates.ts), or the UI would offer
 * to delete a row this service then refuses as "not a duplicate".
 */
export function normalizeItemName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function computeIsStockItem(productTypeCode: string | null): boolean {
  return productTypeCode !== '3';
}

export function computeNeedsProductType(
  productTypeCode: string | null,
): boolean {
  return productTypeCode === null;
}
