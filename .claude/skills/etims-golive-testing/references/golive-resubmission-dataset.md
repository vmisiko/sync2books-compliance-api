# Go-Live Resubmission — Realistic Dataset & TIS Template Checklist

Read this before building **any** item, customer, sale or credit note that will end up in the go-live
evidence. It exists because the first application was rejected, and the rejection was about the receipt,
not the API.

## 1. Why the first application was rejected

All 23 OSCU test cases passed (2026-08-20). KRA still refused the application with:

> "Kindly refer to the TIS Documentation on page 8 and 10 on the invoice and credit note template"

- **Page 8** = the Normal Invoice (receipt label `NS`) sample. **Page 10** = the Normal Credit Note (`NC`)
  sample. Spec: `TIS for OSCU/VSCU Technical Specifications v2.0`, April 2023 — a copy lives at
  `sync2books-compliance-api/.docs/TIS-for-OSCU--VSCU-Technical-Specifications-v2.0.pdf`.
- What KRA opened was `go-live-evidence/screenshots/invoice-copy.pdf` and `credit-note-copy.pdf` — produced by
  `src/sales/application/receipt/etims-receipt-pdf.generator.ts`. The submission pipeline was never the problem.
- The evidence data made it worse: one item, one rate, one line, invoice number `GOLIVE-INV-001`. A single-row
  receipt can't show a tax table, a mixed goods/service invoice, an item counter or a discount — i.e. most of
  what page 8 exists to demonstrate. **A realistic, mixed dataset is part of the fix, not decoration.**
- Full gap analysis and what's already been fixed: `.docs/TIS_TEMPLATE_CONFORMANCE_PLAN.md`.

## 2. Naming rule — non-negotiable

KRA reviewers open these records. Nothing may read as fabricated:

- No `Seed`, `Test`, `Demo`, `Sample`, `GoLive`, `Foo`, `Item 1` in any item name, SKU, customer name,
  supplier name, invoice number, memo or company name. That includes the tenant/company name (the old Step 3
  example `Go-Live Test Company` is exactly the wrong thing to show a reviewer).
- No `seed-*.ts` file and no committed script — build everything through the API, by hand, per session.
- Invoice numbers look like a real trader sequence: `INV-<yymmdd>-<nn>` (e.g. `INV-260917-01`), credit notes
  `CN-<yymmdd>-<nn>`. Use the **actual run date** — they must be unique per run anyway, and a back-dated
  sale invites questions.
- Never attach a PIN to a **real** identifiable business (an earlier draft used "Safaricom PLC" — swapped out).
  Customers and suppliers below are fictional.
- The pre-existing `SEED-*` / `ODOO-SEED-*` / `Sample Customer` rows in the dev QuickBooks company and main-API
  DB are left alone by standing instruction — just never select them for evidence.

## 3. The dataset (mirrors the live QuickBooks catalogue)

This is the same catalogue pushed to the live QuickBooks realm `9341456169531792` on 2026-09-09 (main-API
company `3e97059e-5a2b-4024-9fca-29490222009b`, connection `dd96595f-52b3-4b61-a164-3bed4392f78e`). The
QuickBooks `bookId`s are listed so the eTIMS evidence and the ERP records tell the same story. Values below
were read back from the main-API DB on 2026-09-17, not from memory.

Theme: a Nairobi hospitality business (restaurant + hotel + conference) that also runs a small
fintech/subscription line — which is what lets one tenant legitimately exercise all tax bands and both
item types.

### 3.1 Items

**Prices:** QuickBooks holds tax-**exclusive** unit prices. OSCU and our direct eTIMS sale API treat
`unitPrice` as tax-**inclusive** (`oscu-sales-request.builder.ts`: `splyAmt = qty × unitPrice`, then
`splitTaxInclusiveAmount`; the `taxAmount` you send is recomputed). So for band B send `QB price × 1.16`, or
the receipt TOTAL won't match the QuickBooks invoice total.

| # | Name (exact) | QB id | Type | `taxCategory` | Band | `unitCode` | `packagingUnitCode` | QB price (excl.) | eTIMS `unitPrice` (incl.) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Grilled Goat Ribs (per kg) | 53 | GOODS | VAT_STANDARD | B 16% | `KG` | `NT` | 1,200.00 | 1,392.00 |
| 2 | Dawa Cocktail | 54 | GOODS | VAT_STANDARD | B 16% | `NO` | `NT` | 450.00 | 522.00 |
| 3 | Milled Sorghum Flour 2kg Packet | 32 | GOODS | EXEMPT | A Exempt | `PA` | `BG` | 240.00 | 240.00 |
| 4 | Farm Fresh Milk 500ml | 31 | GOODS | VAT_ZERO | C 0% | `NO` | `NT` | 60.00 | 60.00 |
| 5 | Conference Hall Hire (Full Day) | 55 | SERVICE | VAT_STANDARD | B 16% | `NO` | `NT` | 25,000.00 | 29,000.00 |
| 6 | Deluxe Room Bed and Breakfast (Per Night) | 56 | SERVICE | VAT_STANDARD | B 16% | `NO` | `NT` | 8,500.00 | 9,860.00 |
| 7 | Banquet Service Charge | 57 | SERVICE | OTHER | D Non-VAT | `NO` | `NT` | 500.00 | 500.00 |
| 8 | Starter Subscription Plan (Monthly) | 58 | SERVICE | VAT_STANDARD | B 16% | `NO` | `NT` | 1,500.00 | 1,740.00 |
| 9 | Growth Subscription Plan (Monthly) | 59 | SERVICE | VAT_STANDARD | B 16% | `NO` | `NT` | 4,500.00 | 5,220.00 |
| 10 | Card Payment Processing Fee | 60 | SERVICE | VAT_STANDARD | B 16% | `NO` | `NT` | 150.00 | 174.00 |
| 11 | Loan Facility Arrangement Fee | 25 | SERVICE | EXEMPT | A Exempt | `NO` | `NT` | 3,000.00 | 3,000.00 |
| 12 | Facility Interest Charge | 24 | SERVICE | EXEMPT | A Exempt | `NO` | `NT` | (per facility) | e.g. 4,250.00 |
| 13 | Statutory Filing Disbursement | 61 | SERVICE | OTHER | D Non-VAT | `NO` | `NT` | 2,000.00 | 2,000.00 |

- `externalId` = the QuickBooks id (`"53"` etc.) so the eTIMS item and the ERP item are visibly the same record.
- **Units are all 2-char on purpose.** `itemCd` embeds 2-char slices of `pkgUnitCd`/`qtyUnitCd` and KRA
  cross-checks them; anything else (`U`, `L`, `LTR`, `SET`…) silently registers as `NO`. QuickBooks' own
  unit labels (`Each`, `Day`, `Night`, `Month`) have no 2-char KRA code — `NO` is the honest mapping.
- Band D is `taxCategory: OTHER` in our enum. There is no band E (8%) item: `oscu-mapping.seed.ts` has no
  global `VAT_8` row, so don't introduce one here.
- **Classification (`itemClsCd`) — the sandbox only has 26 codes, and enforces them.** Even
  `{"full":true}` returns just 26 (live animals `1010…`, the root `1000000000`, zero-rated `9901…`). A real
  UNSPSC code (`5020220000`, alcoholic beverages) was rejected live on 2026-09-17: *"Ensure you use a valid item
  classification code from the Get Item Classification List endpoint"* (older registrations with junk codes
  predate that check). Chosen mapping, registered successfully 2026-09-17:
  Grilled Goat Ribs → `1010150800` (Goats) · Farm Fresh Milk → `9901200000` (Zero Rated Goods) · every other
  item → `1000000000` (root). Production eTIMS has the full UNSPSC list — remap there.
- **Check for existing registrations first.** Some of these names were already KRA-registered in the sandbox
  (two "Dawa Cocktail" rows caused an "Insufficient stock" failure on 2026-09-10). Reuse a registered item
  rather than creating a same-named duplicate.
- Never re-`/initialize` the device to "clean up" — see the corruption warning in `SKILL.md`.

### 3.2 Opening stock (goods only — services are exempt from stock per TIS §6.29)

Always pass `unitPrice` (tax-inclusive) or the KRA `insertStockIO`/`saveStockMaster` push is skipped.
Compliance-api stock is in-memory; redo this after any restart.

| Item | Qty | `unitPrice` |
|---|---|---|
| Grilled Goat Ribs (per kg) | 60 | 1,392.00 |
| Dawa Cocktail | 120 | 522.00 |
| Milled Sorghum Flour 2kg Packet | 80 | 240.00 |
| Farm Fresh Milk 500ml | 150 | 60.00 |

Enough headroom for every document in §3.4 plus a retry. If a sale fails with "not in your stock", check
for duplicate item rows before blaming KRA.

### 3.3 Customers and suppliers

Buyer PINs (supplied by the user 2026-09-17, sandbox): Amani Business Park Ltd `P052581715V`, Coastal Retail
Distributors `P052581714V`. Grace Wanjiru has none (walk-in).


| Name | QB id | Email | Phone | Address | Use for |
|---|---|---|---|---|---|
| Amani Business Park Ltd | 14 | accounts@amanibusinesspark.co.ke | +254733221100 | Waiyaki Way, Nairobi | B2B — Buyer PIN printed |
| Coastal Retail Distributors | 16 | finance@coastalretail.co.ke | +254722998877 | Nkrumah Road, Mombasa | B2B — Buyer PIN printed |
| Grace Wanjiru | 15 | grace.wanjiru82@gmail.com | +254712345678 | — | Walk-in consumer — Buyer PIN blank (legitimate, TIS marks it optional) |

Suppliers (for purchase test cases, if needed): Rift Valley Butchery Ltd `P051223344X` (QB 17), Highlands
Dairy Cooperative `P051667788M` (18), Nairobi Cloud Systems Ltd `P051998877T` (19), Zamani Telecom Solutions
Ltd `P051073775V` (20).

**Customer PINs were empty everywhere before 2026-09-17** — `customers.tax_id` in the main-API DB and
`dashboard_customers.tin` in compliance are both `NULL` for all three (checked 2026-09-17), and QuickBooks
drops the PIN on push anyway (plan §2.5). The direct eTIMS sale API takes `customerTin` per sale, so pass it
there. **Ask the user which PINs to use before creating any B2B sale** — a well-formed invented PIN may belong
to a real taxpayer; KRA's sandbox-issued PINs the user controls (e.g. the integrator PIN) are the safe choice.

### 3.4 Documents — each one is a page-8/page-10 test case

Use the real run date in every number and date. `customerName` always set; `customerTin` for B2B only.

| # | Number | Customer | Payment (`paymentTypeCode`) | Lines (qty × eTIMS unitPrice) | Proves | Receipt TOTAL |
|---|---|---|---|---|---|---|
| 1 | INV-…-01 | Amani Business Park Ltd | Credit `02` | Dawa Cocktail 24 × 522 | Baseline single rate B | 12,528.00 |
| 2 | INV-…-02 | Coastal Retail Distributors | Credit `02` | Goat Ribs 5 × 1,392 · Sorghum Flour 10 × 240 · Milk 20 × 60 | **Mixed rates B+A+C** — tax table | 10,560.00 |
| 3 | INV-…-03 | Amani Business Park Ltd | Bank cheque `04` | Conference Hall Hire 1 × 29,000 · Goat Ribs 8 × 1,392 · Banquet Service Charge 1 × 500 | **Mixed goods + service, B+D** — the case KRA queried. **Use this as `invoice-copy.pdf`** | 40,636.00 |
| 4 | INV-…-04 | Grace Wanjiru | M-Pesa `07` | Starter Subscription Plan 1 × 1,740 | Service-only, no stock, walk-in (blank Buyer PIN) | 1,740.00 |
| 5 | INV-…-05 | Coastal Retail Distributors | Cash `01` | Farm Fresh Milk 50 × 60 | Zero-rated only | 3,000.00 |
| 6 | INV-…-06 | Coastal Retail Distributors | Card `06` | Sorghum Flour 15 × 240 | Exempt only ("Total TAX exempted amount") | 3,600.00 |
| 7 | INV-…-07 | Amani Business Park Ltd | Credit `02` | Deluxe Room B&B 3 × 9,860 | Accommodation, service B | 29,580.00 |
| 8 | CN-…-01 | Amani Business Park Ltd | Bank cheque `04` | Against #3: Goat Ribs 2 × 1,392 · Banquet Service Charge 1 × 500 | **Partial credit note, goods + service** — **use as `credit-note-copy.pdf`** | −3,284.00 |

Documents 1–3 and 5–7 match QuickBooks invoices 17–23 line-for-line (QuickBooks carries them all as Credit —
the payment spread here is deliberate, because a synced QuickBooks `Invoice` can only ever be `02`; see plan §1.1).

- **Sale:** `POST /companies/$COMPANY_ID/integrations/etims/sales?submit=true` with
  `receiptTypeCode: "S"`, `invoiceStatusCode: "02"`, `customerName`, optional `customerTin`, and each line
  `{id, quantity, unitPrice, taxCategory, taxAmount, itemDescription}`. Compute `taxAmount` as
  `total − round(total/1.16, 2)` for B, `0` otherwise — it's recomputed server-side, but keep it honest.
- **Partial credit note (#8):** the express endpoint credits the *whole* sale, which is the wrong shape for
  this case. Use the same `POST .../sales` with `receiptTypeCode: "R"`, `originalTraderInvoiceNumber: "INV-…-03"`,
  `creditNoteDate`, `creditNoteReasonCode` (e.g. returned goods / price adjustment from KRA cdCls 32), and only
  the two credited lines (positive quantities — the renderer negates). Confirm #3 is `ACCEPTED` first.
- **Always send `customerName`.** KRA requires a credit note's `custNm` to equal the original sale's `custNm`,
  and NPEs if it is null. Until 2026-09-17 compliance-api dropped `customerName` on `POST /api/sales` (and the
  payload builder never mapped it), so INV-260917-01..07 went to KRA nameless and **can never be credited** —
  they were re-issued as -08..-14. Both bugs are fixed.
- **Discount document — not yet.** `EtimsCreateSaleLineItemDto` accepts `discountRate`/`discountAmount`, but
  `oscu-sales-request.builder.ts` still hardcodes `dcRt: 0, dcAmt: 0` and the PDF has no discount rows (plan
  §2.3). Sending a discount today yields an undiscounted KRA record — don't put one in the evidence until
  2.3 lands.
- After each: confirm `complianceStatus = ACCEPTED` in `compliance_documents`, then pull the PDF with
  `curl "http://localhost:3001/api/sales/<url-encoded-document-id>/receipt" -o <name>.pdf`.

## 3.5 Live run log — 2026-09-17 (new THIRDPARTY app)

- Apigee app `6405a624-c94d-440e-abc5-f4cc381d5f12`, pin `P600004555A`, integrator pin `P052581715V`, device
  `SYNCP052581715V`. `.env` updated (old app backed up outside the repo at `~/.sync2books-env-backups/compliance-api.env.bak-oldapp-20260917`).
- Main-API company `580e7da6-f713-4277-8eae-389215afcd17` "SYNC TO BOOKS RECONCILER LIMITED" (application
  `379dd0a1-…`, dev key). Provision → `/initialize` succeeded first call: `deviceId 451263`,
  **`sdcId KRACU0400001214`** (captured automatically), `mrcNo KRA00379695`. Compliance tenant
  `29cf1c15-…`, branch `6eefc407-…` (bhfId `00`).
- `/selectBhfList`: "Headquarter", Jamhuri, Langata District, Nairobi → written to
  `tradeAddressLine1`/`tradeCity`; header/footer messages set on the tenant (no API for either yet — DB write).
- All 13 items REGISTERED (item ids `item-580e7da6-f713-4277-8eae-389215afcd17-legacy-<QB id>`), e.g. Dawa
  Cocktail `KE2NTNO0000001`, Sorghum Flour `KE2BGPA0000012`, Goat Ribs `KE2NTKG0000013`.
- Opening stock added via compliance-api `PUT /api/stock/adjust` (the main-API stock DTO has no `unitPrice`,
  so its push to KRA would be skipped). The response's `etims.stockIo/stockMaster.status` is the only place
  the KRA outcome shows — stock ops are not in `oscu_operation_logs`. Dawa Cocktail is 121 (one top-up to
  read that field).

**Result 2026-09-17 — evidence set, all ACCEPTED** (PDFs in `.docs/go-live-evidence/resubmission-2026-09-17/`):

| Doc | Receipt | TOTAL | Notes |
|---|---|---|---|
| INV-260917-08 | `KRACU0400001214/8 NS` | 12,528.00 | = #1 |
| INV-260917-09 | `/9 NS` | 10,560.00 | = #2 mixed B+A+C |
| INV-260917-10 | `/10 NS` | 40,636.00 | = #3 → `invoice-copy.pdf`; KRA portal verified |
| INV-260917-11 | `/11 NS` | 1,740.00 | = #4 M-Pesa, no PIN |
| INV-260917-12 | `/12 NS` | 3,000.00 | = #5 cash, zero-rated |
| INV-260917-13 | `/13 NS` | 3,600.00 | = #6 card, exempt |
| INV-260917-14 | `/14 NS` | 29,580.00 | = #7 |
| CN-260917-02 | `/15 NC` | −3,284.00 | = #8 against -10 → `credit-note-copy.pdf`; KRA portal verified |

Superseded, don't use: INV-260917-01..07 (receipts 1–7, KRA has no customer name) and CN-260917-01 (REJECTED,
can't succeed — its original has a null custNm).

## 4. Pre-flight blockers — check each before generating evidence PDFs

Status as verified 2026-09-17. Re-check; don't trust this list blindly.

| # | Blocker | State | How to check / fix |
|---|---|---|---|
| 1 | **SCU ID** — old connection's `sdcId` was `NULL` (printed `dvcId` instead) | ✅ new app 2026-09-17: `KRACU0400001214` captured at initialize | `select sdcId from compliance_etims_connections where dvcSrlNo='SYNCP052581715V'` |
| 2 | **Trade address + commercial messages** (`compliance_branches.tradeAddressLine1/tradeCity`, `compliance_tenants.receiptHeaderMessage/receiptFooterMessage`) | ✅ set for the new tenant 2026-09-17 (still no API/dashboard field) | Populate from the KRA-registered branch (`/selectBhfList`: "Headquarter", Bungoma) or `POST /dashboard-api/branches/pull`; set header/footer messages (page 8: "Welcome…" / "THANK YOU…"). |
| 3 | **Customer PINs** | ✅ 2026-09-17 | See §3.3. |
| 4 | **KRA logo** (§6.28, every receipt) — PDF draws a bordered placeholder | ❌ open | Needs the official asset from the user / KRA portal. Do not source it yourself. |
| 5 | **COPY watermark** (§11, §6.17) — Download/Print reprints the original unmarked | ❌ open | Plan §3.4. KRA will reprint. |
| 6 | **Discounts** (page 8 discount narration, TOTAL BEFORE DISCOUNT, TOTAL DISCOUNT AWARDED) | ❌ open | Plan §2.3 — see §3.4 above. |
| 6b | **Receipt totals overstated** — PDF/dashboard added line `taxAmount` on top of the tax-inclusive `qty × unitPrice` (printed 14,256 where KRA recorded 12,528) | ✅ fixed 2026-09-17 | Receipt now uses the same `splitTaxInclusiveAmount` as the KRA request. Stored `compliance_documents.totalAmount/subtotalAmount` still use the old convention — don't read receipt figures from them. |
| 6c | Title for a normal sale was `TAX RECEIPT`; page 8 says `TAX INVOICE` | ✅ fixed 2026-09-17 | |
| 7 | Tax table A–E all rows always, totals → payment+amount → ITEMS NUMBER → tax table order | ✅ fixed 2026-09-10 | Verify on the PDF. |
| 8 | Credit note `ORIGINAL CU INVOICE NO.#` + verbatim "CREDIT NOTE IS APPROVED ONLY FOR ORIGINAL SALES RECEIPT" + all amounts negative + `TOTAL B-16.00%` / `TOTAL TAX B` + `NC` label | ✅ fixed 2026-09-09 | Verify on the PDF. |
| 9 | Dash-every-4 internal data / signature, SCU date/time from `sdcDateTime`, TIS INFORMATION block | ✅ fixed 2026-09-09 | Verify on the PDF. |
| 10 | QR resolves on `etims-sbx.kra.go.ke` with `Invoice Number` equal to our printed CU INVOICE NO. | ✅ fixed 2026-09-09 | Scan/open each; old PDFs in `go-live-evidence/` carry the broken URL — regenerate. |

## 5. Page 8 / page 10 acceptance checklist (tick against every PDF)

**Normal invoice (page 8), top to bottom:** KRA logo · Trade name · Shop address, City · `PIN:` ·
`TAX INVOICE` · header commercial message · `Buyer PIN:` (B2B) · each line: description, `unit price x qty`,
line total **with tax letter suffixed** (`12,528.00B`, `2,400.00A-EX`) · discount narration (when 2.3 lands) ·
`TOTAL BEFORE DISCOUNT` / `TOTAL DISCOUNT AWARDED` (when 2.3 lands) · `SUB TOTAL` · `VAT` · `TOTAL` ·
payment method **with amount** (`CASH 3,000.00`) · `ITEMS NUMBER n` · tax table rows EX / 16% / 0% / Non-VAT /
8%, all present · `SCU INFORMATION`: Date, Time, `SCU ID: KRACU…`, `CU INVOICE NO.: KRACU…/n NS`, Internal
Data (dashed), Receipt Signature (dashed) · QR · `TIS INFORMATION`: receipt number, date, time · footer
commercial message.

**Credit note (page 10):** logo · trade name/address/PIN · `CREDIT NOTE` · `ORIGINAL CU INVOICE NO.#:` =
the original sale's **CU** number (not our `INV-…`) · "CREDIT NOTE IS APPROVED ONLY FOR ORIGINAL SALES
RECEIPT" · Buyer PIN · lines negative with tax letter · `TOTAL` negative · `TOTAL B-16.00%` · `TOTAL TAX B` ·
`TOTAL TAX` · payment method negative · `ITEMS NUMBER` · SCU block with `…/n NC` · TIS block · message.

Where the spec text and a live KRA-certified receipt disagree, the certified receipt wins (that's how the
all-five-rows tax table rule was settled).

## 6. Evidence refresh (the 4 uploads)

1. **Item Creation** — the item list showing the 13 registered items (mixed types/bands), not one item.
2. **Invoice Generation** — document #3 accepted (receipt no., signature, `etimsUrl`).
3. **Invoice copy** — PDF of #3.
4. **Credit note copy** — PDF of #8.

Update `go-live-evidence/README.md` with the new document ids/receipt numbers, and write the covering note
citing page 8 / page 10 field-by-field (§5 above is that list).
