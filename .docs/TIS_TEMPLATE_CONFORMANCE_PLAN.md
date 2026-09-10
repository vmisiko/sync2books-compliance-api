# TIS Template Conformance — Go-Live Rejection Remediation Plan

**Trigger:** KRA rejected the go-live application (all 23 test cases had passed) with:
> "Kindly refer to the TIS Documentation on page 8 and 10 on the invoice and credit note template"

**Source of truth:** `TIS for OSCU/VSCU Technical Specifications v2.0` (April 2023) — §4 (receipt labels),
§6.20–6.30 (TIS obligations), §11–13 + page 8 sample (Normal Invoice), §14 + page 10 sample (Credit Note).

**Scope note:** the 23 test cases exercised the *OSCU API* and all pass. This rejection is about the
**printed/PDF artifact** we submitted as `invoice-copy.pdf` / `credit-note-copy.pdf`. Nothing in the
submission pipeline is wrong; the renderer is.

---

## 0. Where the templates actually live

Four renderers all draw the same receipt and all drift from the spec independently. Any fix has to land in
one place and be consumed by the rest, otherwise we resubmit and get rejected on whichever copy KRA opens.

| Renderer | File | Role |
|---|---|---|
| **PDF (authoritative — this is what KRA reviewed)** | `sync2books-compliance-api/src/sales/application/receipt/etims-receipt-pdf.generator.ts` | Download/Print, and the file attached back to QuickBooks/Odoo/Dynamics/Xero |
| On-screen receipt dialog | `Next-Sync-2-books-compliance-dashboard-ui/app/(dashboard)/invoice/_components/sale-invoice-receipt.tsx` | What a merchant sees |
| POS 80mm print | same file, `posPrintRef` block | Thermal print path |
| Email body | `sync2books-compliance-api/src/sales/application/receipt/receipt-email.renderer.ts` | Emailed receipt |

**Decision:** introduce one `buildReceiptViewModel(document, connection, kraRaw, items, tenant)` in
compliance-api that returns every field the spec names, already formatted (dashed signature, dd/mm/yyyy,
tax table rows, item counter, totals block). All four renderers consume it. The dashboard gets it over the
existing `SaleReportDto` — extend that DTO rather than recomputing in React.

---

## 1. Conformance gap — Normal Invoice (page 8)

Legend: ✅ present · ⚠️ present but wrong · ❌ absent

| TIS field | Status | Detail / where |
|---|---|---|
| Trade name | ✅ | `supplierName` ← `tenant.displayName` |
| **Shop address, City** | ❌ | Not stored anywhere. `ComplianceConnection` has only `kraPin`, `kraBhfId`, `deviceId`, `dvcSrlNo`. Needs a field. |
| Supplier PIN | ✅ | |
| Title (`TAX INVOICE`) | ✅ | `DOCUMENT_TITLE` map |
| **Commercial message (header)** | ❌ | e.g. "Welcome to our shop" — merchant-configurable |
| Buyer PIN (optional) | ✅ | |
| Item description / unit price / qty / total | ✅ | |
| **Tax designation appended to line amount** (`1000.00A-EX`, `6,720.00B`) | ⚠️ | We put the letter in a separate `Tax Cat.` column. The sample suffixes the amount. Low risk, but match the sample. |
| **Discount % + narration line** | ❌ | Not rendered, and not carried: `dcRt`/`dcAmt` are hardcoded `0` in `oscu-sales-request.builder.ts:55-56`, `sales.service.ts:466-467,988-989`. |
| **TOTAL BEFORE DISCOUNT** | ❌ | |
| **TOTAL DISCOUNT AWARDED** (negative, parenthesised) | ❌ | |
| **Total TAX exempted amount** | ❌ | Derivable from bucket A |
| SUB TOTAL (excl. tax) | ✅ | labelled "Subtotal" — relabel |
| VAT | ✅ | labelled "Tax" — relabel |
| TOTAL | ✅ | |
| **Payment method + amount** (`CASH  6340.00`) | ⚠️ | We print the description with no amount |
| **ITEMS NUMBER** | ❌ | §6.25 makes the item counter an explicit TIS obligation |
| **Tax table — all programmed rates** | ✅ FIXED 2026-09-10 | **Corrected against a live KRA-certified receipt (DigiTax) the user provided as a reference, which supersedes the original textual reading below:** all five rows (A/B/C/D/E) print unconditionally on every receipt, zero by default. Original (superseded) reading: §6.21 *every rate programmed with value > 0 must print even when unused*; §6.22 zero-rate rows print only when used — with our rate map (`A0 B16 C0 D0 E0`) that would have meant only row B always prints. The empirical DigiTax reference overrides that reading. Also corrected: totals/payment/ITEMS NUMBER print **before** the tax table (page 8 order), not after. |
| `SCU INFORMATION` heading | ❌ | §6.23.1 names the literal designation |
| **SCU date/time** (`Date: dd/mm/yyyy  Time: hh:mm:ss`) | ⚠️ | We print `document.saleDate`. Spec wants the OSCU's own clock — `sdcDateTime` from the sales response. It's parsed in `kra-sales-save-response.mapper.ts:46` but never rendered. |
| **SCU ID** (`KRACU04XXXXXXXX`) | ❌ **real data gap** | We print `connection.deviceId` (`450682`, the `dvcId`). The spec's SCU ID is `sdcId` — `KRACU0400001074` for our go-live device, confirmed by the live KRA portal receipt in `go-live-evidence/README.md`. `sdcId` is returned by `/selectInitOsdcInfo` and **we do not persist it**. |
| **CU INVOICE NO.** (`{SCU ID}/{receipt no}`) | ⚠️ | Right shape, wrong ID (see above) |
| **Receipt counter `A/B RT`** | ❌ | `curRcptNo`/`totRcptNo` + receipt label. `totRcptNo` is parsed but never stored or shown. |
| **Internal data, dashed every 4 chars** | ⚠️ | §6.23.6 — we print raw |
| **Receipt signature, dashed every 4 chars** | ⚠️ | §6.23.7 — we print raw |
| QR code | ✅ | Fixed 2026-09-09, verified live on `etims-sbx.kra.go.ke` |
| **`TIS INFORMATION` block** (TIS receipt no, TIS date, TIS time) | ❌ | Whole section missing |
| **Commercial message (footer)** | ❌ | "THANK YOU …" |
| **KRA logo** | ❌ | §6.28: on every receipt, every type |
| **Receipt label** (NS/NC/CS/CC/TS/TC/PS) | ❌ | §4.3. Also gates §11: COPY/TRAINING/PROFORMA need a watermark + "THIS IS NOT AN OFFICIAL RECEIPT" at ≥2× the amount text size. |

## 2. Conformance gap — Credit Note (page 10)

| TIS field | Status | Detail |
|---|---|---|
| Title `CREDIT NOTE` | ✅ | |
| **`ORIGINAL CU INVOICE NO.#`** | ⚠️ **this is almost certainly the headline rejection** | We print `Ref invoice: {originalDocumentNumber}` — the *trader's* invoice number. The spec demands the original **CU/SCU receipt number** (the `{sdcId}/{curRcptNo}` of the sale being credited). We can derive it: `originalSaleId` → original document → its `etimsReceiptNumber`. |
| **"CREDIT NOTE IS APPROVED ONLY FOR ORIGINAL SALES RECEIPT"** | ❌ | Verbatim required text |
| **All amounts negative** | ⚠️ verify | Line totals, per-rate totals, total tax, payment amount must all render negative |
| **`TOTAL B-16.00%` / `TOTAL TAX B` per-rate lines** | ❌ | Credit note totals block has a different shape from the sale's tax table |
| **Receipt label `NC` on the CU invoice no.** (`KRACU.../259 NC`) | ❌ | |
| Buyer PIN | ✅ | |
| Reduction-in-price % line | ❌ | Same discount gap as §1 |
| SCU / TIS information blocks | ❌ | Same as §1 |
| Credit-note log book: reason + description + **recipient name** | ⚠️ | §14 — we store `creditNoteReasonCode`, not the free-text justification or recipient name |

## 3. "Non-physical information" / mixed item types

Modelled but never surfaced. `ComplianceItem.productTypeCode` (`itemTyCd`) with `deriveItemType()` —
`'3'` = SERVICE, everything else = GOODS. Consequences:

- §6.29 (a receipt for **goods** can't be issued below stock; **services** are exempt) is already enforced
  at `sales.service.ts:294`. Good.
- The receipt gives the reader no way to tell a service line from a goods line. The page 10 sample marks it
  on the line. Add the marker to the line renderer.
- This is what makes a **mixed invoice** demonstrable: goods + service on one document, different `itemTyCd`,
  different `taxTyCd`, one receipt.

---

## Phase 1 — Demo catalogue and the mapping that has to be right first

**Naming rule, non-negotiable.** Nothing in this dataset may read as fabricated. No "Seed", "Test", "Demo",
"Sample", "Foo", "Item 1" in item names, SKUs, descriptions, customer names, invoice references or memos —
KRA reviewers open these records. Use names a real Nairobi restaurant or SaaS vendor would actually have.
No file called `seed-*.ts` either; the one existing `oscu-mapping.seed.ts` is unrelated infrastructure
(global mapping defaults) and stays as it is. Build this catalogue through the API, not from a script
committed to the repo.

We cannot demonstrate a mixed-rate / mixed-type invoice template with the data we have. Build the catalogue
in QuickBooks through our own API (`POST /items/:connectionId`, `POST /invoices/:connectionId`) — never by
writing to QuickBooks directly, so the push path is exercised too.

### 1.0 What mapping infrastructure already exists

Better than a first read suggests. Three mapping tables, all with the same tenant-row-then-global-fallback
shape, plus KRA's own code lists already synced locally:

| Concern | KRA field | KRA code list | Our mapping table | Resolver | Actually wired? |
|---|---|---|---|---|---|
| Tax type | `taxTyCd` | `oscu_codes` cdCls `04` | `tax_mappings` (by internal tax category) | `ClassificationResolverTypeOrm.resolveTaxTyCd` | ✅ yes |
| Payment method | `pmtTyCd` | `oscu_codes` cdCls `07` | `payment_type_mappings` | `PaymentTypeResolverTypeOrm.resolve` | ⚠️ resolver exists, but callers pass a constant — see 1.1 |
| Quantity unit | `qtyUnitCd` | `oscu_codes` cdCls `10` | `unit_mappings` | **none** | ❌ table is written and never read — see 1.2 |
| Packaging unit | `pkgUnitCd` | `oscu_codes` cdCls `17` | none by design | per-item, hand-set in Item Sync | ✅ per-item |
| Classification | `itemClsCd` | `oscu_item_classifications` | none by design | per-item, hand-set in Item Sync | ✅ per-item |

KRA's lists are already local — 755 codes across 21 groups, synced by `/selectCodeList` (go-live evidence
#2) into `oscu_code_classes` + `oscu_codes`, searchable via `GET /api/dashboard/mappings/codes`. So the
"table from KRA" exists for both payment methods and units; what is missing is the wiring below.
Background: `.docs/ETIMS_CLASSIFICATION_UNIT_PACKAGING_CODES.md`.

### 1.1 Payment methods — the resolver is bypassed on every synced invoice

`DashboardInvoicesApplicationService.createSaleFromInvoice` (`dashboard-invoices.application.service.ts:379`)
hardcodes the internal bucket:

```ts
const paymentTypeCode = await this.paymentTypeResolver
  .resolve(merchantId, 'CREDIT')      // <- constant, every single invoice
  .catch(() => '02');
```

The reasoning in the comment is sound — a QuickBooks `Invoice` is by definition an on-credit document, and
a paid-at-till sale is a `SalesReceipt`, which our pull never touches. But the consequences are real:

- **Every invoice we sync prints "Credit".** We cannot demonstrate Cash, M-Pesa, Card or Bank Cheque on a
  synced document, which is exactly what a restaurant demo needs to show.
- `MainApiInvoice` (`main-api-pull.client.ts:90`) has no payment-method field, and neither does the main
  API's own `Invoice` entity — so the pull could not carry one even if the resolver were consulted.
- `getPaymentMethods()` exists on the pull client, but only to populate the mapping table for review. It
  never feeds a document.

**KRA payment method codes (cdCls `07`) and our internal buckets** — global defaults already seeded by
`oscu-mapping.seed.ts`, aliases in `mapping-suggestion.service.ts`:

| `pmtTyCd` | KRA meaning | Internal bucket | Auto-matches these ERP labels |
|---|---|---|---|
| `01` | Cash | `CASH` | cash |
| `02` | Credit | `CREDIT` | credit, on account, on credit, invoice |
| `03` | Cash/Credit | `CASH_CREDIT` | cash/credit, cash and credit |
| `04` | Bank Cheque | `BANK_CHECK` | check, cheque, bank check, bank cheque |
| `05` | Debit and Credit Card | `DEBIT_CREDIT` | debit card, credit card, visa, mastercard |
| `06` | Card | `CARD` | card, e-check, echeck |
| `07` | Mobile Money | `MOBILE_MONEY` | mobile money, m-pesa, mpesa, till, paybill, airtel money |
| `08` | Other | `OTHER` | other |

**What to do, in order:**

1. **For the demo now** — create the cash/M-Pesa/card documents through the manual sale path, which already
   accepts an explicit code (`dashboard-sales.controller.ts:130`, `api-sales.controller.ts:117`), and let
   the synced QuickBooks invoices carry `CREDIT` honestly. That is a truthful picture of both paths.
2. **Pull the merchant's QuickBooks payment-method catalogue** into `payment_type_mappings` via
   `POST /api/dashboard/mappings/pull`, review the suggestions, approve. M-Pesa in particular must land on
   `07`, not `08`. Do this before creating any documents.
3. **Fix the gap properly (post-resubmission):** support QuickBooks `SalesReceipt`. A restaurant's cash
   sales genuinely are SalesReceipts, not Invoices — today we simply do not see them. That is a product
   gap, not just a demo gap, and it is where the resolver's per-document payment method finally earns its
   keep. Requires `paymentMethodRef` on `MainApiInvoice` and on the main API's `Invoice` entity — additive,
   nullable, one deploy cycle each way.

### 1.2 Quantity units — the table is written but never read

`unit_mappings` is populated by the Mapping Center (pull → suggest → approve) and read by **nothing**.
`ClassificationResolverTypeOrm.resolveClassification` does `const unitCode = params.unitCode ?? null` —
no lookup. Approving a unit mapping in the dashboard changes no downstream behaviour today; `qtyUnitCd`
comes only from whatever Item Sync passes per item.

**Then there is a harder constraint that shapes the catalogue itself.** `itemCd` is
`orgnNatCd(2) + itemTyCd(1) + pkgUnitCd(2) + qtyUnitCd(2) + seq(7)`, and KRA cross-checks the embedded
slices against the flat fields (confirmed live 2026-09-01: both a 1-char `L` and a 3-char `BLL` were
rejected with `The ItemCd isn't made up of correct QtyUnitCd`). `sync-items.usecase.ts` therefore
substitutes `NO` (and `NT` for packaging) into **both** places whenever the real code is not exactly two
characters. KRA's own cdCls `10` list is 1, 2 and 3 characters wide, so **any item whose true unit is not a
2-character code silently registers as "Number"**.

KRA cdCls `10`, split by whether it survives `itemCd`:

| Survives (2 chars — use these) | Substituted to `NO` |
|---|---|
| `DZ` dozen · `KG` kilogramme · `LK` link · `M2` square metre · `M3` cubic metre · `NO` number · `NX` part per thousand · `PA` packet · `PG` plate · `PR` pair · `RL` reel · `RO` roll · `ST` sheet · `TU` tube | `U` pieces/item · `L` / `LTR` litre · `M` / `MTR` metre · `GRM` gram · `MGM` milligram · `GLL` gallon · `GRO` gross · `KTM` kilometre · `KWT` kilowatt · `MWT` megawatt-hour · `LBR` pound · `SET` set · `TNE` tonne · `YRD` yard |

Note the trap: `U` ("Pieces/item") is the unit KRA's *own spec samples* use for a generic item, and it
degrades. Use `NO` deliberately for piece-priced goods. Litre-measured items have no 2-character option at
all — bottled drinks will register as `NO` whatever we do, so either price them per piece (honest for a
restaurant) or accept the substitution knowingly.

**What to do:** pick every catalogue unit from the left-hand column. Separately, decide whether
`unit_mappings` should feed `resolveClassification` as a fallback when Item Sync leaves `unitCode` unset,
or whether the table should be dropped as misleading. Not required for resubmission — but leaving a
dashboard control that does nothing is worse than not having it.

### 1.3 Customers and suppliers — what round-trips, and the buyer-PIN gap

**Customer**, main API `Customer`, created via `POST /customers/:connectionId`:

| Field | Our model | → QuickBooks | ← QuickBooks pull | → compliance / receipt |
|---|---|---|---|---|
| Name | `name` / `displayName` | `DisplayName` ✅ | ✅ | `customerName` ✅ |
| Email | `email` | `PrimaryEmailAddr` ✅ | ✅ | `customerEmail` ✅ |
| Phone | `phone` | `PrimaryPhone` ✅ | ✅ | `customerPhoneNumber` ✅ |
| **TIN / KRA PIN** | `taxId` | ❌ **dropped** — only `Taxable: true` is sent | ❌ **not read** | `tin` → `customerPin` → Buyer PIN ✅ |
| Address | `address` | `BillAddr` ✅ | ✅ | not used on the receipt |

The PIN is the one field that does not round-trip through QuickBooks. `toQuickBooksCustomer()`
(`customer.entity.ts:125`) turns `taxId` into a boolean `Taxable` flag and discards the value; the pull
(`customer.service.ts:265-300`) maps thirteen fields and `taxId` is not one of them. `PrimaryTaxIdentifier`
and `ResaleNum` appear nowhere in the repository. Every other ERP does carry it — Odoo `partner.vat`, Xero
`contact.TaxNumber`, Dynamics `taxRegistrationNumber` — and Odoo and Dynamics read it back
(`customer.service.ts:365,455`). QuickBooks is the odd one out.

**Two things make this survivable for the catalogue:**

1. The QuickBooks customer pull is **insert-only** (`customer.service.ts:262`) — an already-known customer
   is only ever un-deleted, never field-updated. So a `taxId` we set at creation is never overwritten by a
   later sync.
2. The downstream chain is intact: `Customer.taxId` → `MainApiCustomer.taxId` →
   `ComplianceCustomer.tin` (`dashboard-customers.application.service.ts:298,316`) →
   `document.customerPin` → Buyer PIN on the receipt.

**So:** create every customer through `POST /customers/:connectionId` **with `taxId` populated**, and the
buyer PIN reaches the receipt correctly even though QuickBooks itself won't display it. What we cannot do
is recover a PIN for a customer that originated inside QuickBooks — see 2.5.

**Supplier** is in better shape. `POST /suppliers/connection/:connectionId` accepts `supplierName`,
`emailAddress`, `phone`, `taxNumber`, `registrationNumber`, and `taxNumber` both pushes to QuickBooks
`Vendor.TaxIdentifier` (`supplier.entity.ts:142`) and is read back on pull (`supplier.service.ts:586`).
Nothing to fix.

**Does the receipt need the buyer PIN?** It is optional per TIS §5.1.3 and the page 8 sample ("Buyer's
Personal Identification Number (optional)"). But a blank buyer PIN on the invoice copy we hand KRA invites
exactly the kind of second look we are trying to avoid, and a Kenyan B2B buyer needs it to claim input VAT.
Populate it on every B2B document; walk-in consumer sales can legitimately leave it blank, and having one
of each actually demonstrates both paths.

**PIN values — a caution.** Kenyan PINs are letter + 9 digits + letter (`P051234567M` for a company,
`A0…` for an individual). Do not invent well-formed PINs at random for a live QuickBooks instance and a
live KRA submission: a plausible-looking PIN may belong to a real taxpayer. Use PINs the merchant actually
controls, or the go-live Application Test Pin family already recorded in `go-live-evidence/README.md`
(`P600004185A`, `P600004165A`). Confirm with the merchant before creating any customer record that carries
a PIN.

### 1.4 The catalogue

*Restaurant / hotel* — goods + services, four tax treatments, all units 2-char:

| Item | `itemTyCd` | `taxTyCd` | Rate | `qtyUnitCd` | `pkgUnitCd` |
|---|---|---|---|---|---|
| Nyama Choma — Goat, per kg | 2 finished | B | 16% | `KG` | `NT` |
| Dawa Cocktail | 2 finished | B | 16% | `NO` | `NT` |
| Maize Flour 2kg | 2 finished | A | Exempt | `PA` | `BG` bag |
| Fresh Milk 500ml | 2 finished | C | 0% | `NO` | `NT` |
| Conference Room — Full Day | 3 service | B | 16% | `NO` | `NT` |
| Deluxe Room — Bed & Breakfast | 3 service | B | 16% | `NO` | `NT` |
| Catering Service Charge | 3 service | D | Non-VAT | `NO` | `NT` |

*Financial services / subscription* — service-only, exercises the no-stock path (§6.29):

| Item | `itemTyCd` | `taxTyCd` | `qtyUnitCd` |
|---|---|---|---|
| Starter Plan — Monthly Subscription | 3 | B | `NO` |
| Growth Plan — Monthly Subscription | 3 | B | `NO` |
| Loan Arrangement Fee | 3 | A (exempt financial service) | `NO` |
| Facility Interest | 3 | A | `NO` |
| Payment Processing Fee | 3 | B | `NO` |
| Statutory Filing Disbursement | 3 | D | `NO` |

Every item also needs an `itemClsCd` from `oscu_item_classifications` — set per item in Item Sync, no
auto-match exists. Pick a genuinely appropriate classification; a wrong one is visible to KRA.

### 1.5 Tax-code mapping

Confirm every QuickBooks tax code used above resolves to the intended `taxTyCd` via
`POST /api/dashboard/mappings/pull` → review → `POST /api/dashboard/mappings/:id/approve`. Two specific
hazards:

- Unmapped lines default to `B` in places (`purchase-kra-confirmation.builder.ts:68`) — an unmapped exempt
  item would be **taxed** on the receipt. Verify each, don't assume.
- `oscu-mapping.seed.ts` seeds global tax rows for `EXEMPT`/`VAT_STANDARD`/`VAT_ZERO`/`OTHER` only. There is
  **no global row for `VAT_8`**, so an 8%/`E` item has no fallback. We are not using `E` in this catalogue
  (the sandbox rate for `E` is 0 anyway — see `oscu-tax-rates.ts`), but add the row before anyone tries.

### 1.6 Documents to create

Each one is a template test case as much as a data record:

1. Goods-only, single rate B — the baseline.
2. **Mixed rates**: B + A + C on one invoice — proves the tax table.
3. **Mixed item types**: goods + service on one invoice — the case KRA queried.
4. Service-only subscription — proves the no-stock path.
5. **Line discount + invoice-level discount** — currently unrepresentable; drives Phase 2.3.
6. Zero-rated only, and exempt only — each proves a single tax row prints correctly.
7. **Payment-method spread** via the manual sale path: one Cash (`01`), one M-Pesa (`07`), one Card (`06`),
   one Bank Cheque (`04`) — the synced invoices cover Credit (`02`).
8. A credit note against #3 — partial return of one goods line and one service line.

### 1.7 Housekeeping

Redundant QuickBooks records already deleted (done). After building the catalogue, run
`POST /items/connection/:connectionId/sync-from-bookkeeping` and
`POST /invoices/connection/:connectionId/sync-from-bookkeeping`, then verify through the main API's own
`GET /items` and `GET /invoices` — never by querying QuickBooks or the DB directly.

## Phase 2 — Close the data gaps the template needs

Ordered by whether the template can be rendered at all without them.

**2.1 DONE (2026-09-09)** — persisted (`ComplianceEtimsConnectionOrmEntity.sdcId`/`.mrcNo`,
captured in `parseOscuInitializeDeviceInfo`/`compliance-organization.application.service.ts`'s
`initializeEtimsConnection`; `ComplianceDocumentOrmEntity.totRcptNo`/`.sdcDateTime`/`.receiptLabel`,
captured in `submit-document.usecase.ts` at the ACCEPTED transition). `synchronize: true` means these
columns exist as soon as the server restarts — no migration file needed in this repo. Credit note's
original CU invoice number is resolved **at render time** in `sales.service.ts#getEtimsReceiptPdf`
(fetches `document.originalSaleId`'s own `etimsReceiptNumber`/`receiptLabel`) rather than stored — simpler,
and can't drift from the original document.
- **Still open:** the existing go-live connection's `sdcId` is still `null` — it predates this fix and
  nothing has backfilled it. The correct value is already on record
  (`KRACU0400001074`, `go-live-evidence/README.md`) but writing it requires either a live `/initialize`
  call (**do not** — that device serial has the open KRA-side corruption bug, see this repo's `CLAUDE.md`)
  or direct write access this session didn't have (blocked on the compliance-api dashboard login, see
  [[project_tis_template_golive_rejection]]). Whoever has DB access or the dashboard login should call
  `upsertEtimsConnection` (or write the column directly) with the known-good value — no KRA call needed.

**2.2 PARTIAL (2026-09-09)** — merchant/branch presentation data:
- ✅ Schema + plumbing done: `ComplianceBranchOrmEntity.tradeAddressLine1`/`.tradeCity`,
  `ComplianceTenantOrmEntity.receiptHeaderMessage`/`.receiptFooterMessage`, all wired through to
  `ComplianceConnection` and consumed by the renderer (falls back to a generic default message when null).
- ❌ Not done: nothing pulls `/selectBhfList` to auto-fill address, and there's no dashboard field yet for a
  merchant to type one in by hand either — the columns exist and render correctly once populated, but
  nothing populates them yet. Same for the commercial messages: renderable, not yet settable.
- ❌ Not done: KRA logo. No official asset exists anywhere in this workspace, and it isn't something to
  source without authorization (brand/trademark asset from a government agency) — the PDF currently draws a
  bordered "KRA" placeholder box in its place. Needs the real logo file from the user or KRA's own developer
  portal before this is truly done.

**2.3 Discounts** — the one genuine feature gap:
- Carry `discountRate`/`discountAmount` at line and document level from the ERP invoice through
  `ComplianceLine`/`ComplianceDocument` into `dcRt`/`dcAmt` on the OSCU payload (today hardcoded `0`).
- Render: per-line discount narration, TOTAL BEFORE DISCOUNT, TOTAL DISCOUNT AWARDED (negative).
- **Cross-repo caution:** additive fields only, defaulting to 0, so compliance-api and main API stay
  compatible for a deploy cycle in each direction.

**2.4 Credit-note log book** (§14): free-text justification + recipient name alongside
`creditNoteReasonCode`, retrievable for audit.

**2.5 QuickBooks customer tax identifier** (`nest-sync-2-books-api`) — not a QuickBooks limitation,
purely an implementation gap: `PrimaryTaxIdentifier` is a real, optional, documented field on the
QuickBooks Customer object (Intuit's own Customer API reference lists it directly). `toQuickBooksCustomer()`
never sets it and the pull never reads it back.

One real constraint from QuickBooks itself, though: **`PrimaryTaxIdentifier` is masked in every API
response, exposing only the last five characters** (`123-45-6789` → `XXXXXX56789`, per Intuit's docs).
That caps what a *pull* can ever recover — a KRA PIN (`P051234567M`, 11 chars) read back from QuickBooks
would come back as `XXXXX4567M`, unusable as a Buyer PIN. So:

- For a customer **we create**: push `taxId` → `PrimaryTaxIdentifier` on create, and keep our own DB (the
  value we just sent) as the source of truth — never re-derive it from QuickBooks's masked echo, including
  the create response itself. Fully fixable, no data loss.
- For a customer that **originated in QuickBooks** with a PIN already set there before we ever touched it:
  permanently unrecoverable in full. The pull can only confirm one exists, never reconstruct it. Flag these
  customers for manual PIN entry through our own dashboard rather than silently leaving `customerPin` null.

Confirm first that the production QuickBooks company's locale actually exposes `PrimaryTaxIdentifier` (it
is locale/minorVersion-gated in some QuickBooks editions; `ResaleNum` is the documented US-only fallback) —
check `bookResponseData` on an existing pulled customer, since the full raw QuickBooks payload is already
retained there, before writing any mapping code. Not blocking for resubmission (see 1.3, which routes
around this by creating catalogue customers through our own API with `taxId` set directly), but every
customer that already existed in the production QuickBooks company before this plan has a blank buyer PIN
until this lands or someone re-enters it by hand.

## Phase 3 — Rewrite the renderer

**3.1/3.2/3.3 DONE (2026-09-09, corrected 2026-09-10)** — `etims-receipt-pdf.generator.ts` rewritten in
place against the page 8 and page 10 samples, in spec order: logo placeholder → trade name/address/PIN →
title → QR → header commercial message → (credit note: original CU invoice no. + verbatim approval
statement) → invoice/buyer/supplier details → lines (tax-designation-suffixed amount, goods/service
marker) → totals → payment method (with amount) → ITEMS NUMBER → tax table → SCU INFORMATION (real
`sdcId`, dash-every-4 internal data/signature) → TIS INFORMATION → footer message. Credit notes render
every amount negated at the presentation layer (`Math.abs` first, so it's correct regardless of the sign
the domain model happens to store) and use `TOTAL {rate}-{pct}%` / `TOTAL TAX {rate}` labels per the page
10 sample instead of the sale's per-category labels.

**2026-09-10 correction:** the first pass (a) put ITEMS NUMBER and the tax table *before* the totals
block instead of after, and (b) only guaranteed row B always prints (others only when used), per a
textual reading of §6.21/§6.22. The user supplied a live KRA-certified receipt (DigiTax) as ground truth,
which shows both **all five rows (A-E) always printing, zero by default** and **totals/payment/ITEMS
NUMBER before the tax table**. Both are now fixed to match; treat the empirical reference as
authoritative over the standalone spec-text reading wherever they'd otherwise disagree.

Deviated from the original 3.1 plan of a separate `receipt-view-model.ts` module — the formatting logic
lives inline in the generator instead (helper functions `dashEvery4`/`formatScuDateTime`, exported for
testing). Revisit extracting a shared module only when 3.5 (propagating to the other three renderers)
actually happens — no point building the abstraction before there's a second consumer.

Covered by `etims-receipt-pdf.generator.spec.ts` (7 tests: dash-every-4, SCU datetime parsing, and
end-to-end smoke tests for a sale, a credit note, and a connection-less document). Full compile
(`npx tsc --noEmit`) and the full suite (40 suites/307 tests) are green as of this change.

**Known gaps carried into this rewrite, not fixed here:**
- Discounts still don't render (2.3 is still open — nothing to render).
- Buyer PIN is only ever what `document.customerPin` already holds — no fabrication, per the standing
  no-invented-real-world-identifiers rule; blank is correct for a walk-in sale.
- The "TIS INFORMATION" receipt number reuses `document.documentNumber` (our own trader invoice number) —
  there is no dedicated TIS-internal sequence counter anywhere in this codebase to draw on instead.
- KRA logo is a placeholder box (see 2.2).

**3.4** §11 receipt types: COPY / TRAINING / PROFORMA get the watermark, the below-header designation, and
"THIS IS NOT AN OFFICIAL RECEIPT" at ≥2× the amount text size. At minimum implement COPY — §6.17 says only
one original may print and every reprint must be watermarked, and our Download/Print buttons currently
reprint the original unmarked. **KRA will test this.**

**3.5 PARTIAL (2026-09-10)** — dashboard dialog and its POS 80mm print block
(`sale-invoice-receipt.tsx`) rewritten to match: all-five-rows-always tax table (matching the
corrected PDF rule above; the POS print block previously had no tax table at all), correct
page-8 ordering (totals/payment/ITEMS NUMBER before the tax table), SCU ID (`scuId`, not
`serialNumber`/`deviceId`), composed CU Invoice No. with receipt label, a TIS INFORMATION block, trade
address/commercial messages, credit-note original-invoice banner + verbatim approval
statement, goods/service marker per line. `credit-note-content.tsx`'s list filter now
prefers `isCreditNote` over the old `receiptTypeCode === "R"` check, with that check kept
as a fallback for a sale fetched before the new field existed.

Backing DTO (`SaleReportDto`/`SaleReport`) extended with `scuId`/`cuInvoiceNo`/`totRcptNo`/
`scuDate`/`scuTime`/`receiptLabel`/`isCreditNote`/`originalCuInvoiceNo`/`itemsNumber`/
`tradeAddress`/`receiptHeaderMessage`/`receiptFooterMessage`, computed by one shared
`buildScuFields()` helper in `sales.service.ts` used by both the list and detail builders
(previously two independently-duplicated functions — the same drift class this whole plan
exists to stop). `internalData`/`receiptSignature` now arrive already dash-every-4-formatted;
`salesTaxSummary`/`itemList` amounts arrive already negative for a credit note, so neither
frontend consumer needs its own copy of either rule. The list view deliberately does not
resolve `originalCuInvoiceNo` (would add a document lookup per row) — same tradeoff already
made for `syncErrorMessage`; only the single-sale detail fetch resolves it.

Compliance-api: `tsc --noEmit` clean, full suite green (40/307). Dashboard-ui: `tsc --noEmit`
clean on every file this touched (2 pre-existing, unrelated errors remain in
`erp-connection-content.tsx`). No test runner exists in this repo (see this repo's own
CLAUDE.md) and no live visual verification was possible this session -- the compliance-api
dashboard login needed to actually load this page is still the open blocker from Phase 1's
[[project_tis_template_golive_rejection]] update. Verify visually once that's unblocked.

**Not yet touched:** `sale-detail-panel.tsx`'s "eTIMS Metadata" card (a technical inspector,
not a receipt replica -- already shows the now-correctly-dashed signature/internal data for
free, no code change needed there) and `receipt-email.renderer.ts`'s email body (still the
old un-TIS-ified HTML).

## Phase 4 — Fresh end-to-end test and resubmission

1. Re-run the go-live checklist against the sandbox using the Phase 1 catalogue, via the
   `etims-golive-testing` skill. Sandbox only — never production.
2. For each of the seven Phase 1 invoices plus the credit note, pull the PDF from
   `GET /api/sales/:documentId/receipt` and check it field-by-field against the page 8 / page 10 tables above.
   Treat those two tables as the acceptance checklist.
3. Verify each QR resolves on `etims-sbx.kra.go.ke` and that the portal's `Invoice Number` matches the
   `CU INVOICE NO.` we printed. Regenerate the QR-stale PDFs already sitting in `go-live-evidence/`.
4. Confirm the receipt attaches correctly to QuickBooks and Odoo (this pipeline was live-verified for both
   on 2026-08-30; re-verify after the renderer rewrite).
5. Refresh `go-live-evidence/README.md` and the four required upload artifacts:
   Item Creation, Invoice Generation, invoice copy, credit note copy — with the mixed-rate, mixed-type
   invoice as the invoice copy, since that is what KRA queried.
6. Resubmit, citing page 8 / page 10 line by line in the covering note.

---

## Sequencing

Phase 1 → 2.1/2.2 → 3.1/3.2/3.3 → 4 is the critical path to resubmission. Within Phase 1, the mapping work
(1.1 payment-method pull/approve, 1.2 unit selection, 1.5 tax-code approval) comes **before** any item or
document is created — a document built on an unapproved mapping has to be voided and rebuilt, and a credit
note cannot un-say a wrong `pmtTyCd`.

Separable, and safe to defer past resubmission: 2.3 (discounts), 3.4 (COPY/TRAINING/PROFORMA), the
`SalesReceipt` support in 1.1 step 3, and the `unit_mappings` decision in 1.2. Of these, do 2.3 and 3.4
first if the schedule allows — both are visible on the page 8 sample and in §11, and a second rejection
costs more than the week they take.

## Open questions

1. Does KRA want the receipt label (`NS`/`NC`) printed as a standalone field, or only appended to the CU
   invoice number as the page 10 sample shows? The sample only shows the latter — print both, it is free.
2. §6.23.8 defines the QR payload as `date#time#cuNumber#cuReceiptNumber#internalData#receiptSignature`,
   but the page 8 sample and the live portal use the `indexEtimsReceiptData?Data=` URL. Our URL form is
   verified working against the live portal — keep it, and flag the discrepancy in the covering note rather
   than switching to a format the portal cannot read.
3. §6.5 X/Z daily reports (§15/§16) are a TIS obligation we do not implement at all. Not cited in this
   rejection — confirm with the reviewer whether it is in scope before go-live, because it is a large build.
