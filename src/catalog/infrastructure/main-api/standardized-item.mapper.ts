import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import type { RegisterItemInput } from '../../application/use-cases/register-item.usecase';

/**
 * Main API's actual, Codat-faithful item-type vocabulary — not collapsed to a GOODS/SERVICE
 * bucket there, since that collapse is a KRA-specific simplification (KRA's item-type code list
 * has no "non-stock good" concept) that doesn't belong in a shape meant to serve any consumer.
 * This repo does its own collapse — see deriveProductTypeCode() below.
 */
export type MainApiStandardizedItemType = 'Unknown' | 'Inventory' | 'NonInventory' | 'Service';

/**
 * Shape returned by MainApiPullClient.getItems() — see integration/main-api-pull. `itemType` is
 * sourced from the main API's `standardized` field (MainApiItem.standardized.itemType in
 * main-api-pull.client.ts) where that's available, and otherwise from the raw `itemType` column
 * via normalizeRawItemType() below — main API owns ERP-shape normalization (QuickBooks Type
 * parsing etc.), but NOT tax-authority-specific categorization; that's still this repo's job,
 * done by the caller (see DashboardItemsApplicationService.pullItems) via
 * MappingSuggestionService against `defaultTaxCodeRef.name`, and passed in as `taxCategory`.
 */
export interface MainApiPulledItem {
  id: string;
  itemCode: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  active: boolean;
  itemType: MainApiStandardizedItemType;
  unitOfMeasure?: string | null;
  defaultTaxCodeRef?: { id: string; name?: string } | null;
  bookId?: string | null;
  bookType?: string | null;
  unitPrice?: number | null;
  /**
   * The ERP's on-hand quantity, where it has one. Main API returns it only
   * for stock-tracked items (QuickBooks QtyOnHand, Odoo qty_available), so
   * its mere presence corroborates `itemType` -- see deriveStockTracked.
   */
  qtyOnHand?: number | null;
}

/**
 * Collapses main API's raw `itemType` column (the pre-standardization value: QuickBooks'
 * 'Inventory'/'Service'/'NonInventory', Odoo's 'consu'/'service'/'combo') onto the standardized
 * vocabulary, for rows where main API returned `standardized: null` because its own
 * Item.toStandardized() doesn't cover that bookType yet (an ERP it hasn't implemented, or a
 * locally-created row that hasn't synced and so carries no bookType at all). Anything
 * unrecognized — including a row with no itemType at all — is 'Unknown', which is a real,
 * expected value here, not a gap: see deriveProductTypeCode for what happens to it.
 */
export function normalizeRawItemType(
  raw?: string | null,
): MainApiStandardizedItemType {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'service':
      return 'Service';
    case 'inventory':
      return 'Inventory';
    case 'noninventory':
    case 'non-inventory':
    case 'consu':
      return 'NonInventory';
    default:
      return 'Unknown';
  }
}

/**
 * The confident half of the product-type decision: `Service` is unambiguous across every ERP
 * here and maps straight to KRA's itemTyCd '3'. `Inventory`/`NonInventory`/`Unknown` are not —
 * that's an accounting distinction (stock-tracked vs not), NOT the same axis as KRA's Raw
 * Material vs Finished Product split, which no ERP here models at all. So this returns
 * undefined for them, and the caller supplies '2' (Finished Product) as a *default* via
 * RegisterItemInput.defaultProductTypeCode instead of asserting it here — the difference
 * matters: a default never overrides a product type a human already picked on the item
 * (registerItem prefers `existing.productTypeCode`), whereas a value returned from here would.
 */
function deriveProductTypeCode(
  itemType: MainApiStandardizedItemType,
): string | undefined {
  return itemType === 'Service' ? '3' : undefined;
}

/**
 * Records whether the ERP maintains a quantity for this item. Informational
 * only -- see CatalogItem.stockTracked. It does NOT decide `isStockItem`.
 *
 * The reason that matters, and the reason `false` here is completely normal:
 * **QuickBooks Essentials and Simple Start have no inventory feature at all.**
 * On those plans every item is Service or NonInventory by construction, no
 * `QtyOnHand` is ever returned, and a merchant selling real goods is simply
 * running their stock outside QuickBooks. Only Plus and Advanced expose
 * Inventory items. So a whole catalogue coming back `stockTracked: false`
 * says nothing about whether those goods need a KRA stock master -- they
 * usually do. (Confirmed 2026-09-10: reading this signal as "not stocked"
 * un-stocked 38 real goods on an Essentials tenant, including the item whose
 * "does not exist in your stock master" rejection started that work.)
 *
 * What it IS good for: `false` means no `qtyOnHand` will ever arrive, so
 * reconcile cannot maintain that item's stock and someone has to adjust it by
 * hand -- otherwise an invisible and confusing state. And a flip to `true`
 * marks the moment an ERP starts supplying quantities for an item it never
 * did before (a plan upgrade, or an item converted to Inventory), which
 * DashboardItemsApplicationService.pullItems treats with care rather than
 * letting the first ERP number silently overwrite hand-kept stock.
 *
 * `Unknown` falls back to the presence of `qtyOnHand`, which main API returns
 * only for quantity-tracked items -- and to `undefined` when even that is
 * missing, so the row keeps whatever it already had rather than recording a
 * definite `false` on the strength of a normalization gap upstream.
 */
function deriveStockTracked(
  itemType: MainApiStandardizedItemType,
  qtyOnHand?: number | null,
): boolean | undefined {
  switch (itemType) {
    case 'Service':
      return false;
    case 'Inventory':
      return true;
    case 'NonInventory':
      return false;
    default:
      return qtyOnHand != null ? true : undefined;
  }
}

export function mapMainApiItemToRegisterItemInput(params: {
  merchantId: string;
  item: MainApiPulledItem;
  /** Resolved by the caller via MappingSuggestionService.suggestTaxCodeMapping — see DashboardItemsApplicationService.pullItems. */
  taxCategory: TaxCategory;
}): RegisterItemInput {
  const { merchantId, item } = params;

  // `externalId` must match InvoiceLineItem.itemRef.id from the same pull surface
  // (the raw ERP item id) so invoice lines can resolve to this catalog item later.
  const externalId = item.bookId ?? item.itemCode;

  return {
    merchantId,
    externalId,
    name: item.name,
    sku: item.sku ?? null,
    productTypeCode: deriveProductTypeCode(item.itemType),
    stockTracked: deriveStockTracked(item.itemType, item.qtyOnHand),
    // Goods default to Finished Product rather than landing PENDING on
    // needsProductType. Only ever applied when the item has no product type
    // from any other source (no Service signal above, nothing a human already
    // set) -- see RegisterItemInput.defaultProductTypeCode.
    defaultProductTypeCode: '2',
    taxCategory: params.taxCategory,
    // classificationCode/unitCode/packagingUnitCode are deliberately omitted
    // here -- no ERP tells us these, and register-item.usecase.ts's
    // existing-preferring fallback means omitting them is safe for both a
    // brand new item (lands PENDING with needsClassificationMapping true,
    // fixed once in Item Sync) and an existing one (a re-pull never erases
    // what a human already set there -- see that fallback's doc comment for
    // the incident this fixed).
    // Main API's Item.unitPrice is a MySQL `decimal` column -- TypeORM/mysql2
    // serialize decimal columns as strings over the wire to avoid float
    // precision loss, despite MainApiItem's own TS type claiming `number`.
    // Coerced here (not left for the caller to notice) so a downstream
    // string-vs-number comparison (e.g. registerItem's unchanged-item check)
    // doesn't see every re-pull as "changed" purely from the type mismatch.
    unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
  };
}
