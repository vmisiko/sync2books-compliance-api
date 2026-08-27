# ERP Item Field Mapping: What Can and Can't Be Auto-Resolved

## Why this doc exists

The compliance dashboard auto-suggests KRA eTIMS fields (`taxTyCd`, `pmtTyCd`, `qtyUnitCd`, `pkgUnitCd`, `itemTyCd`, `itemClsCd`) from ERP source data, with varying success: tax and payment method resolve at 88-98% confidence; quantity unit, packaging unit, product type, and item classification code frequently land on "Needs Review" or worse (a false-looking default). This was investigated in 2026-08 (QuickBooks + Odoo only) to find out *why*, per field, rather than treating "Needs Review" as one undifferentiated problem.

The finding: there are three structurally different situations hiding under that one label, and they need three different responses — a matcher fix, a smart default, and an acknowledged permanent manual step. Conflating them (e.g. "just expand the matcher" or "just ask the user to enable something in QuickBooks") wastes effort on the two fields where it can't work. Re-run this same field-by-field check for every new ERP integration (Xero, Sage, etc.) — a field that's automatable from QuickBooks may not exist at all in another ERP's schema, and vice versa.

See also [`ETIMS_CLASSIFICATION_UNIT_PACKAGING_CODES.md`](./ETIMS_CLASSIFICATION_UNIT_PACKAGING_CODES.md) for what the KRA-side target values (`itemClsCd`, code lists) actually look like — this doc is about the *source* side: what ERPs give us to map from.

## The matrix

| Field | ERP source data exists? | Current behavior | Root cause | Category |
|---|---|---|---|---|
| **Tax mapping** (`taxTyCd`) | Yes — QuickBooks/Odoo tax names follow a standard convention (`"16.0% S"`) | Auto-resolves, 88-98% confidence | Matches a closed 5-value KRA vocabulary via regex against standardized ERP tax names (`MappingSuggestionService.suggestTaxCodeMapping`, `sync2books-compliance-api/src/regulatory/oscu/application/mapping-suggestion.service.ts:217-291`) | Rule-mappable — working |
| **Payment method** (`pmtTyCd`) | Yes — small set of real-world labels ("Cash", "M-Pesa", "Credit Card") | Auto-resolves | Matches a closed 8-value vocabulary via alias list (`KNOWN_PAYMENT_METHODS`, same file, lines 78-124) against QuickBooks `PaymentMethod.Name` / Odoo `pos.payment.method.name` | Rule-mappable — working |
| **Quantity unit** (`qtyUnitCd`) | **Yes** — QuickBooks `Item.UQCDisplayText` (mapped in `nest-sync-2-books-api/src/item/application/item.service.ts:210`), Odoo `product.product.uom_id[1]` (same file, line 299) | Frequently "Needs Review" | **Our bug, not a data gap.** `suggestUnitMapping` (`mapping-suggestion.service.ts:294-322`) only recognizes 3 unit families in `KNOWN_UNITS` (pieces/EA, KG, LTR). Anything else — boxes, dozens, cartons, grams, metres — arrives populated and legible but unmatched | Rule-mappable — **matcher needs expanding, not a fundamental gap** |
| **Packaging unit** (`pkgUnitCd`) | **No — doesn't exist in either ERP's item model at all.** No field in `OdooProduct` (`odoo.models.ts`) or QuickBooks' Item schema | Always "Needs Review" unless qty-unit happened to match | Never independently resolved; each `KNOWN_UNITS` entry hardcodes `'NT'` as a side effect of a qty-unit match. `ClassificationResolverTypeOrm.resolveClassification()` (`classification-resolver.typeorm.ts:63-67`) throws if missing | **Structurally unmappable from source — always manual, for any ERP that lacks a packaging concept** |
| **Product type** (`itemTyCd`) | Partial. QuickBooks `Item.Type`: Inventory/Service/NonInventory. Odoo `product.type`: consu/service/combo + `is_storable`. Neither carries KRA's actual axis (raw material vs. finished product vs. service) — see 2026-08-27 Odoo follow-up below for whether category/BoM data could | Deliberately never auto-guessed for goods; Service items do resolve (`'3'`). As of 2026-08-27, goods default to Finished Product in the *review UI only* (not persisted) with an explicit confirm required — see `ITEM_MAPPING_CONSOLIDATION_PLAN.md` Phase 2 | By design, not a failed heuristic — `deriveProductTypeCode` (`standardized-item.mapper.ts:47-51`) only sets Service unambiguously; goods resolve to `null`. Comment in `catalog-item.entity.ts:24-36` calls guessing this "fabricating data KRA requires a human to actually decide" | **Compliance-sensitive — auto-guessing risks a wrong KRA submission, not just a UX inconvenience. No Mapping Center rule is possible for this field at all — see below** |
| **Unit price** | Passed straight through, no classification logic at all | "Needs review" cases are very likely a null/zero price at source (e.g. a service item with no price set) | QuickBooks `UnitPrice` / Odoo `list_price` → `Item.unitPrice` → `CatalogItem.unitPrice` (`catalog-item.entity.ts:63`) | Data-quality flag, not a mapping problem — treat "missing price" as a distinct UI state from "needs classification" |
| **Item classification code** (`itemClsCd`) | No usable signal — neither ERP pull captures a category field at all | Always starts `null`; UI shows a search-assisted combobox that defaults to an unsearched alphabetical list on open | Deliberately out of scope by design, not a gap: `suggestClassificationPlaceholder()` (`mapping-suggestion.service.ts:361-372`) explicitly refuses to guess against a ~thousands-row, 5-level UNSPSC-style taxonomy. QuickBooks `ItemCategoryRef` isn't even declared in the codebase; Odoo `categ_id` is never pulled; `IncomeAccountRef` is fetched but unused for this purpose | **Missing-input problem, not a matcher gap — no lookup-table fix is available until category data is actually pulled from source** |

## Would an ERP-side setting fix any of this?

Checked before assuming the answer was "tell the user to enable X in QuickBooks/Odoo":

- **Qty unit**: No — the data already arrives usable. The fix is entirely on our side (expand `KNOWN_UNITS`).
- **Packaging unit**: No — there's no packaging/carton/case concept anywhere in QuickBooks or Odoo's item model to expose, regardless of settings.
- **Product type**: No for QuickBooks — no field, no setting creates one. For Odoo specifically, re-checked 2026-08-27 (see dedicated section below): partially. Odoo's Manufacturing app (BoM data) *could* give a real, non-guessed raw-material-vs-finished-product signal if the merchant has it configured, but product category can't (it's free-text and not usable without guessing).

`sync2BooksDocumentation/integrations/{quickbooks-online,odoo}/*` had no documentation of these limitations as of this investigation — worth adding a short note there once the qty-unit matcher fix ships, so it's user-facing knowledge too, not just internal.

## Recommended response per field

1. **Qty unit**: expand `KNOWN_UNITS` aliases. Real fix, low risk, should push most items to auto-resolved.
2. **Product type**: default goods to "Finished Product" (the common case) with a one-click confirm rather than a blank required field — cuts friction without silently fabricating a compliance-relevant value.
3. **Packaging unit**: accept it's permanently manual per item; design the UI for that rather than implying it's a solvable mapping problem.
4. **Item classification code**: not auto-mappable without new source data. Two independent workstreams, either is worth doing on its own:
   - **Fix the false-default risk now** (found 2026-08-27): the classification combobox fires an unsearched, alphabetically-first fetch the moment it opens, so `itemClsCd 1000000000` ("Live Plant and Animal Material...") can end up saved against completely unrelated items (observed on a flour item) if a user saves without searching. Don't show any pre-selected value until the user has actually typed a query, or block save on an untouched selection — this is a data-integrity risk independent of whether auto-suggestion ever gets built.
   - **Longer term**: pull category-equivalent fields where the ERP has them (QuickBooks `ItemCategoryRef`/`IncomeAccountRef`, Odoo `categ_id` — neither is currently fetched at all) and invest in fuzzy/ranked search on `itemClsNm` rather than attempting a guess-the-code classifier, which the team's own code comments already rule out as intractable at this taxonomy size.

## 2026-08-27 follow-up: does Odoo's category or BoM data give a real product-type signal?

Raised because product type ended up excluded from the Mapping Center rule-based tabs entirely (unlike qty unit) — worth checking whether that's really permanent for Odoo specifically, the same way the packaging-unit finding turned out to have a real answer for Odoo (`product.packaging`, just never pulled).

**Confirmed via `grep` against `nest-sync-2-books-api/src/odoo/odoo.service.ts`**: the Odoo integration touches exactly these models today — `res.partner`, `account.account`, `account.tax`, `account.analytic.account`, `product.product`, `ir.module.module`, `pos.payment.method`, `account.move`/`account.move.line`, `ir.attachment`, `account.payment`/`account.payment.register`. Zero category or manufacturing models (`product.category`, `mrp.bom`) anywhere.

**Category (`product.category`/`categ_id`)** — technically trivial to pull (every product has one, no module-installed gate needed, unlike `pos.payment.method`'s existing `ir.module.module` check). But it's a free-text, merchant-configured hierarchy — Odoo's own defaults are generic ("All / Saleable", "All / Expenses", "All / Consumable"), none of which mean raw-material-vs-finished-product unless a specific merchant set up custom categories for that purpose. Using it would mean keyword-guessing category names per merchant — the same class of unreliable heuristic already ruled out for `itemClsCd` matching elsewhere in this codebase. **Not usable without guessing.**

**BoM (`mrp.bom`, the Manufacturing app)** — structurally a real, non-guessed signal: a product that only ever appears as a BoM *component* (input to something else) is genuinely a raw material; a BoM's *output* is genuinely a finished product. This isn't a heuristic, it's a fact about the merchant's own data.

**The catch is coverage, not correctness — not confirmed with real usage data, reasoned from context**: Manufacturing is a substantial, separately-installed Odoo app. Odoo's own signup flow (`.docs/ODOO_CONNECTOR_SETUP_GUIDE.md`) highlights a "free one-app plan," and this integration's target merchants (per the `odoo-kenya-seed-data` skill) are small Kenyan restaurants/retail/service businesses, not manufacturers. Most such merchants almost certainly don't have Manufacturing installed or any BoMs configured — meaning even a properly-gated pull (mirroring the `ir.module.module` check `getPaymentMethods()` already does for POS) would return a real signal for a small minority of items/merchants, with everyone else still needing the per-item default-and-confirm flow regardless. No telemetry exists on how many currently-connected Odoo tenants actually have Manufacturing installed — this is a reasoned expectation, not a measured fact.

**Conclusion**: category is a dead end (same objection as `itemClsCd` name-guessing). BoM is legitimate but likely low-payoff for this product's actual customer base, for real engineering cost (gated pull + new resolution logic). Not prioritized now — revisit if a manufacturing-heavy customer segment shows up. Distinct from packaging unit: that field doesn't exist anywhere in Odoo's product model; this one exists but is probably rarely populated for who's actually using this integration.

## For future ERP integrations

When adding a new accounting tool, re-run this check per field before assuming parity with QuickBooks/Odoo:
- Does the new ERP's item/product object have a native unit-of-measure field? (Likely yes, most ERPs do — check the matcher covers its vocabulary.)
- Does it have any packaging/case/carton concept? (Uncommon — verify per ERP rather than assuming "no" from QuickBooks/Odoo generalizes, but expect the same gap by default.)
- Does it distinguish raw material vs. finished product vs. service, or only a generic goods/service split? (Most accounting-focused ERPs only do goods/service — expect the same compliance-sensitive gap.)
