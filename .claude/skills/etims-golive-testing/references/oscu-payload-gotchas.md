# OSCU payload gotchas

Exact request shapes confirmed working live against KRA's sandbox
(`https://sbx.kra.go.ke/etims-oscu/api/v1`), and the specific ways the "obvious" version of each request
fails. All examples use headers:

```
Authorization: Bearer <token from /v1/token/generate>
apigee_app_id: <Apigee App ID>
tin: <Application Test Pin>
bhfId: 00
cmcKey: <from /initialize>
Content-Type: application/json
```

Get a token:
```bash
curl -s "https://sbx.kra.go.ke/v1/token/generate?grant_type=client_credentials" \
  -H "Authorization: Basic $(echo -n '<client_id>:<client_secret>' | base64)" \
  -H "Accept: application/json"
```
If this returns empty/a connection error, retry once — it's occasionally flaky for no real reason.

## saveItem

The item code (`itemCd`) is not arbitrary. Per OSCU spec §4.19:

```
itemCd = orgnNatCd(2) + itemTyCd(1) + pkgUnitCd(2) + qtyUnitCd(2) + seq(7 digits, from 0000001)
```

Two things about this that aren't obvious from the spec text:

- **`qtyUnitCd` must be exactly 2 characters.** A real, valid business code like `"U"` (Pieces/item, 1 char)
  gets rejected with `400 "Incorrect QtyUnitCd Prefix"` when embedded — even though `"U"` works fine as the
  *separate* `qtyUnitCd` field elsewhere in the same payload. Use a 2-char code like `"NO"` (Number) instead.
  This is already fixed in `sync-items.usecase.ts` (throws instead of silently generating a malformed code)
  and `oscu-mapping.seed.ts` (defaults EA/EACH/PCS to `"NO"`) — if you're calling `saveItem` directly via
  curl rather than through the app, remember this yourself.
- **`seq` must be the next unused value for this tin, strictly incrementing from 1** — not a hash, not
  random. Reusing or skipping breaks with `400 "Invalid itemCd Sequence. Expected sequence ending with: ********N"`,
  which tells you the exact next value. `sync-items.usecase.ts`'s `allocateItemCdSequence` handles this via
  a persistent counter in `oscu_sync_state` — trust it over any local computation if calling through the app.

```json
POST /saveItem
{
  "itemCd": "KE2NTNO0000001",
  "itemClsCd": "1010150000",
  "itemTyCd": "2",
  "itemNm": "Test Item",
  "orgnNatCd": "KE",
  "pkgUnitCd": "NT",
  "qtyUnitCd": "NO",
  "taxTyCd": "B",
  "btchNo": null, "bcd": null, "dftPrc": 100,
  "grpPrcL1": null, "grpPrcL2": null, "grpPrcL3": null, "grpPrcL4": null, "grpPrcL5": null,
  "addInfo": null, "sftyQty": null, "isrcAplcbYn": "N", "useYn": "Y",
  "regrId": "Admin", "regrNm": "Admin", "modrId": "Admin", "modrNm": "Admin"
}
```
Success: `{"resultCd":"000","resultMsg":"Successful"}`.

## insertStockIO — ROOT CAUSE FOUND AND FIXED 2026-08-12, confirmed working end-to-end live

**This spent nearly 24 hours (2026-08-11 evening through 2026-08-12 late morning) misdiagnosed as an
unfixable KRA sandbox-side issue. It was three real client-side bugs the whole time.** If you're reading
this because `insertStockIO` is failing, **do not conclude it's a KRA-side problem** — re-check the three
things below first. The vague, generic-sounding `"Error occurred while validating item tax type: Please try
again later"` error was a red herring that appeared for multiple *different* underlying causes, which is
exactly what made this so hard to pin down: it never pointed at the real problem.

**How it was actually found**: hit KRA's sandbox directly with raw `curl` (fetching a real OAuth token via
`GET {tokenBaseUrl}/v1/token/generate?grant_type=client_credentials` with HTTP Basic, then calling
`/insert/stockIO` by hand), bypassing this codebase entirely. Doing this immediately surfaced KRA's *actual*,
specific validation messages instead of the generic error our own client had been getting — proving the
issue was in our request construction, not KRA's backend. **When you're stuck on a persistent, vague OSCU
error and have already checked the obvious payload fields, drop to raw `curl` before concluding it's
KRA-side** — it strips away every layer of our own code at once and either reproduces the exact same vague
error (pointing at something outside your control) or, as happened here, immediately shows you the real
cause.

**Bug 1 — wrong `bhfId` sent (the actual primary cause, found last).** `InventoryService.syncStockMovementToEtims()`
/ `syncStockMasterToEtims()` built the `EtimsConnectionContext` (and the request's own `bhfId` field) using
`stock.branchId` — the **sync2books-side** branch id (e.g. `"branch-1"`) — instead of `connection.kraBhfId`
(the real KRA branch office code, e.g. `"00"`). For the integrator path style, `bhfId` is sent as an HTTP
**header**, not in the JSON body (see `asJsonBody()` in `etims-adapter.http.ts`), so this was invisible in
the logged request body — you had to know to check the header value specifically. Sending a nonexistent
`bhfId` apparently makes KRA's backend fail some internal per-branch lookup (item-tax-type config?) and fall
back to this generic, unrelated-sounding error instead of a clear "invalid bhfId" message — which is why it
looked like a business-validation problem rather than an addressing problem. The `ComplianceConnection`
entity's own doc comment already warned about exactly this mistake (`kraBhfId: string | null; /** ... NOT
the KRA office code, use kraBhfId for OSCU calls. */`) — every other call site (`oscu-operations.service.ts`'s
`resolveContext()`) already got this right; only the two `InventoryService` stock methods had the bug.
Fixed by using `connection.kraBhfId` in both places, with a guard to skip the sync if it's unset.

**Bug 2 — missing per-item `totAmt`.** The `OscuStockIOSaveReq` type's `itemList[]` entries only had
`totDcAmt`, never `totAmt`. KRA's real endpoint wants a **per-item** `totAmt` in addition to the
transaction-root `totAmt` (same value when there's one line): `400 "Expected a value for totAmt on item: 1
but it is empty or null"`. Confirmed via raw curl — adding it cleared this specific error immediately.

**Bug 3 — `orgSarNo: null`.** The type signature (`number | null`) implied `null` was a valid "no original"
value. It isn't — KRA's Java backend calls `Integer.intValue()` on it and throws an NPE server-side:
`"Expected a value but found null. Possible cause: Cannot invoke \"java.lang.Integer.intValue()\" because the
return value of \"...getOrgSarNo()\" is null"`. Use `0`, never `null`. The type is now `orgSarNo: number`
(non-nullable) to prevent this regressing.

**A fourth, related finding while verifying the fix — Apigee sometimes wraps a genuine business rejection
inside an outer HTTP 200.** `saveStockMaster` returned outer `res.ok === true` (HTTP 200) with
`{responseHeader: {responseCode: 400, debugMessage: "rsdQty mismatch..."}, responseBody: null}` — a real
rejection, silently treated as success because `postOscu()` only checked the outer HTTP status. Fixed in
`postOscu()`: when `responseBody` is `null` and `responseHeader.responseCode >= 300`, treat the call as
failed regardless of the outer HTTP status, so `describeHttpRejection()` and all downstream error handling
correctly kick in.

Two things that were already true and remain true: transaction-level fields belong at the **request root**,
not nested inside `itemList[]` (`400 "regTyCd cannot be null"` otherwise); `ocrnDt` is **8-digit `yyyyMMdd`**,
not 14-digit. Amounts still can't be a literal `0` (`400 "Expected a value for totAmt... but it is empty or
null"`) — use real tax-inclusive math: given tax-inclusive total `T` and 16% VAT (`taxTyCd: "B"`),
`taxblAmt = T / 1.16`, `taxAmt = T - taxblAmt`. `pkg` needs a real count, not `0`. `sarNo` is a
strictly-incrementing-from-1 sequence per tin, same as `itemCd` — **it only advances on KRA's side when a
call actually succeeds**, so if your local counter increments unconditionally (as `allocateSarNo` currently
does) it will drift ahead after any failed attempt; there's no rollback for it the way `sendSalesTransaction`
has for `invcNo` — worth adding if this keeps causing desync after failures.

```json
POST /insert/stockIO
{
  "sarNo": 1,
  "orgSarNo": 0,
  "regTyCd": "M",
  "custTin": null, "custNm": null, "custBhfId": null,
  "sarTyCd": "05",
  "ocrnDt": "20260812",
  "totItemCnt": 1,
  "totTaxblAmt": 862.07,
  "totTaxAmt": 137.93,
  "totAmt": 1000,
  "remark": "MANUAL_ADJUST",
  "regrId": "sync2books", "regrNm": "sync2books", "modrId": "sync2books", "modrNm": "sync2books",
  "itemList": [
    {
      "itemSeq": 1,
      "itemCd": "KE2NTNO0000006",
      "itemClsCd": "1010150100",
      "itemNm": "Final Verify Item",
      "bcd": null,
      "pkgUnitCd": "NT",
      "pkg": 10,
      "qtyUnitCd": "NO",
      "qty": 10,
      "itemExprDt": null,
      "prc": 100,
      "splyAmt": 1000,
      "totDcAmt": 0,
      "taxblAmt": 862.07,
      "taxTyCd": "B",
      "taxAmt": 137.93,
      "totAmt": 1000
    }
  ]
}
```
Confirmed working live end-to-end 2026-08-12 (`resultCd: "000"`), immediately followed by a successful
`saveStockMaster` and a real `sendSalesTransaction` (`receiptNumber`, `receiptSignature`, `etimsUrl` all
populated) for the same item — the full chain works now that the header bug is fixed.

`sarTyCd` codes (OSCU code classification 12): incoming `01` import, `02` purchase, `03` return, `04` stock
movement, `05` adjustment, `06` processing; outgoing `11` sale, `12` return, `13` stock movement,
`14` processing, `15` discarding, `16` adjustment.

## saveStockMaster

Must be called **after** `insertStockIO` for the same `itemCd` — calling it first fails with
`400 "Stock IO is empty, consider adding items to the stock IO first"`.

```json
POST /save/stockMaster
{
  "itemCd": "KE2NTNO0000001",
  "rsdQty": 100,
  "regrId": "sync2books", "regrNm": "sync2books", "modrId": "sync2books", "modrNm": "sync2books"
}
```

`rsdQty` must match KRA's own cumulative recorded stock for this `itemCd` at this branch (the sum of all
prior successful `insertStockIO` quantities for it) — not just your local delta. Mismatch fails with
`400 "rsdQty mismatch. Expected: N but found: M"`.

**A previous version of this doc attributed persistent `sendSalesTransaction` "items not in stock" failures
to the same device/Apigee-app corruption bug documented in `SKILL.md`. That was very likely wrong** — the
real, now-confirmed cause is the `bhfId` bug documented in the `insertStockIO` section above: when stock is
recorded against the wrong (nonexistent) branch, KRA correctly has no stock for the real branch `"00"`, so
`sendSalesTransaction` correctly rejects it. The timing correlation with switching Apigee apps was
coincidental with other fixes happening in the same session, not causal. If you see this failure, check the
`bhfId` header being sent for `insertStockIO`/`saveStockMaster` before assuming it's session corruption.

## sendSalesTransaction

Confirmed working end-to-end 2026-08-11 (real `ACCEPTED` response with a live `receiptSignature` and
`etimsUrl`) after fixing four separate bugs, all present in the "obvious" version of this request:

1. **`pkg` must be a real package count, not `0`.** `400 "Invalid pkg for ItemList 1. Expected: 1, Found: 0"`.
   It's tempting to fix this with `pkg: quantity` (matches the pattern used for `insertStockIO`, below) --
   don't. That single test happened to use `qty: 1`, so `pkg: 1` satisfied both "not 0" and "equals qty" at
   once and looked confirmed. **Confirmed live 2026-09-01 with `qty: 2`: sending `pkg: 2` (== qty) was
   rejected with `400 "Invalid pkg for ItemList 1. Expected: 1, Found: 2"`.** For `sendSalesTransaction`,
   `pkg` is a package *count*, independent of `qty` -- with `pkgUnitCd: "NT"` (no packaging modeled) KRA
   always expects exactly `pkg: 1`, regardless of `qty`. See `oscu-sales-request.builder.ts`.
   This does **not** necessarily hold for `insertStockIO`, which has its own confirmed-live success with
   `pkg: 10, qty: 10` (below) -- KRA validates `pkg` inconsistently across endpoints, so don't generalize
   this rule to other calls without live-testing them individually.
2. **`splyAmt` (qty × unitPrice) is tax-INCLUSIVE**, same rule as `insertStockIO` — `taxblAmt`/`taxAmt` must
   be *derived* from it (`taxblAmt = splyAmt / (1 + rate/100)`), not computed by adding a separately-supplied
   tax amount on top. `400 "Invalid taxblAmt on item: 1. Expected: 86.21, But Found: 100.00"` if you get this
   backwards. The item-level `totAmt` then equals `splyAmt` itself, and the header-level `totAmt` is the sum
   of the item `totAmt`s — not `subtotal + tax` as you'd naively compute it.
3. **`taxRtE` must be `0`, not `8`** (whatever the OSCU docs/examples suggest) — confirmed live:
   `400 "Rule taxRtE failed: Tax rate mismatch. Expected: 0.00, Found: 8"`.
4. **`invcNo` must be a real, persistent, strictly-incrementing-from-1 sequence per tin — never parsed out of
   the human-readable trader invoice number.** A naive `parseInt`/regex match on something like
   `"GLC2-INV-0006"` will pick up the stray `2` from `"GLC2"` and silently send the wrong value:
   `400 "Invalid invcNo sequence, expected: N but found: M"`. **Critically, KRA only advances its own
   counter on an ACCEPTED submission — never on a rejected one.** If your local counter increments on every
   *attempt* (including failed ones, e.g. while you're iterating to fix bugs #1-3 above), it will drift ahead
   of KRA's real expectation, and every subsequent try fails with an "expected" value *lower* than what
   you're sending. Roll your local counter back on a permanent rejection so it stays in sync — see
   `allocateInvoiceSequence`/`releaseInvoiceSequence` in `submit-document.usecase.ts` for the reference
   implementation (persisted in `oscu_sync_state`, keyed `invoice_seq:<kraPin>:<environment>`).

```json
POST /sendSalesTransaction
{
  "invcNo": 1,
  "orgInvcNo": 0,
  "trdInvcNo": "INV-0001",
  "custTin": null, "custNm": null,
  "salesTyCd": "N",
  "rcptTyCd": "S",
  "pmtTyCd": "01",
  "salesSttsCd": "02",
  "cfmDt": "20260811103000",
  "salesDt": "20260811",
  "stockRlsDt": "20260811103000",
  "cnclReqDt": null, "cnclDt": null, "rfdDt": null, "rfdRsnCd": null,
  "totItemCnt": 1,
  "taxblAmtA": 0, "taxblAmtB": 86.21, "taxblAmtC": 0, "taxblAmtD": 0, "taxblAmtE": 0,
  "taxRtA": 0, "taxRtB": 16, "taxRtC": 0, "taxRtD": 0, "taxRtE": 0,
  "taxAmtA": 0, "taxAmtB": 13.79, "taxAmtC": 0, "taxAmtD": 0, "taxAmtE": 0,
  "totTaxblAmt": 86.21, "totTaxAmt": 13.79, "totAmt": 100,
  "prchrAcptcYn": "N",
  "remark": null,
  "regrId": "sync2books", "regrNm": "sync2books", "modrId": "sync2books", "modrNm": "sync2books",
  "receipt": {
    "custTin": null, "custMblNo": null, "rcptPbctDt": "20260811103000",
    "trdeNm": "<Trader Invoicing System Name>", "adrs": null, "topMsg": null, "btmMsg": null,
    "prchrAcptcYn": "N"
  },
  "itemList": [
    {
      "itemSeq": 1,
      "itemCd": "KE2NTNO0000001",
      "itemClsCd": "1010150000",
      "itemNm": "Test Item",
      "bcd": null,
      "pkgUnitCd": "NT",
      "pkg": 1,
      "qtyUnitCd": "NO",
      "qty": 1,
      "prc": 100,
      "splyAmt": 100,
      "dcRt": 0, "dcAmt": 0,
      "taxTyCd": "B",
      "taxblAmt": 86.21,
      "taxAmt": 13.79,
      "totAmt": 100
    }
  ]
}
```
`itemNm` must not be empty — `400 "Expected a value for itemNm on item: 1 but is empty or null"` if it is.
When driving this through `nest-sync-2-books-api`'s direct API, all four issues above and this one are
already fixed in `oscu-sales-request.builder.ts` / `submit-document.usecase.ts` / `create-document.usecase.ts`
— only relevant if calling raw OSCU directly or debugging a regression.

## Credit note (express)

Requires an existing sale with `complianceStatus: ACCEPTED` — check the sale's status in
`compliance_documents` before attempting. Via nest-api's direct API:

```json
POST /companies/:companyId/integrations/etims/sales/credit-notes/express
{
  "branchId": "00",
  "saleId": "<compliance_documents.id of the ACCEPTED sale>",
  "traderInvoiceNumber": "CN-0001",
  "returnDate": "2026-08-11"
}
```

Three more OSCU-required fields the express flow doesn't obviously ask for, all confirmed live 2026-08-11 —
already fixed in `api-sales.controller.ts`'s `createExpressCreditNote` if you're going through the app:

- **`orgInvcNo`** must be the *original sale's real allocated `invcNo`* (its `oscuInvcNo`, looked up via
  `document.originalSaleId`) — not anything parsed from text. `400 "orgInvcNo does not exist. Please update
  the field and try again"` otherwise.
- **`rfdDt`** (credit note date, OSCU) is required — `400 "Missing RfdDt Date"` if null. The express DTO
  only takes `returnDate`; that value now also populates `creditNoteDate` on the document.
- **`rfdRsnCd`** (credit note reason code) is required — `400 "Invalid RfdRsnCd"` if null/missing. Spec codes:
  `01` Missing Quantity, `02` Missing data, `03` Damaged, `04` Wasted, `05` Shortage, `06` Refund. The express
  flow now defaults to `06` if the caller doesn't supply one (`CreateExpressCreditNoteDto.creditNoteReasonCode`).

Or, for a manual (non-express) credit note via the generic `sales` endpoint, set `receiptTypeCode: "R"` and
supply `originalTraderInvoiceNumber` + `creditNoteReasonCode` directly.

Reconfirmed live 2026-08-12 (`status: "completed"`, real `receiptNumber`/`receiptSignature`/`etimsUrl`) —
this is the "Credit Note" Go-Live evidence screenshot.

## updateImportItem (Update Imported Items) — SOLVED 2026-08-20: `remark` must be non-null

**Field names are `itemClsCd` (with "s") and `imptItemSttsCd` (capital S) — same convention as `saveItem`.**
Confirmed against KRA's own "eTIMS-OSCU-Integrator-Automated-Testing-Sandbox" Postman collection (their
official reference), which uses exactly these names. Don't trust the OCR'd spec doc's attribute table
(`itemClCd`, lowercase `imptItemsttsCd`) — it disagrees with its own JSON sample and is wrong; two earlier
versions of this entry went down that dead end.

**The actual bug: `remark: null` crashes the request specifically when `imptItemSttsCd` is `3` (Approved).**
Isolated by testing all four field-name combinations, then all four status values, then finally comparing
against the Postman collection's exact example body field-by-field:

- Wrong field names (`itemClCd`, or lowercase `imptItemsttsCd`) get real, useful errors identifying the
  problem (`resultCd 910 "required: <itemClsCd> and <itemCd>"`, or a canned "expected 3" that doesn't vary
  with the value sent).
- With correct field names, `imptItemSttsCd` values `1`/`2`/`4` all validate fine even with `remark: null`.
- Only `imptItemSttsCd: "3"` combined with `remark: null` crashes with `resultCd 999 "There is an unknown
  error. Please ask administrator"` — reproduced twice in a row, looked exactly like a KRA-side bug on the
  Approve transition specifically.
- **Sending `remark` as a non-empty string (e.g. `"Approved via Go-Live testing"`) instead of `null` fixes
  it** — confirmed `resultCd: "000" "Successful"` on the real `/updateImportItem` path (not just the
  `/importedItemConvertedInfo` alias, which returns success too but doesn't actually persist the status
  change — see below).

```json
POST /updateImportItem
{
  "taskCd": "<real taskCd from selectImportItemList>",
  "dclDe": "<real dclDe, same format as the seed record e.g. \"01022023\">",
  "itemSeq": 1,
  "hsCd": "<real hsCd from the seed record>",
  "itemClsCd": "<your own valid classification>",
  "itemCd": "<your own registered itemCd>",
  "imptItemSttsCd": "3",
  "remark": "Approved via Go-Live testing",
  "modrId": "Admin", "modrNm": "Admin"
}
```

Confirmed working live 2026-08-20 with `resultCd: "000"`. Note: `selectImportItemList`'s own read-back kept
showing the old status (`"2"`) even after this succeeded — same "dashboard/lookup lags behind reality" class
of staleness already documented elsewhere in this file (see `sendSalesTransaction`'s dashboard-badge note);
trust the direct `resultCd 000` response from your own write call, not a subsequent read.

**`/importedItemConvertedInfo` is NOT a reliable alias for `/updateImportItem`, despite an earlier note in
this file claiming so** (based only on matching *error* responses for bad input on 2026-08-12). Calling
`/importedItemConvertedInfo` with the same corrected payload also returns `resultCd 000`, but a following
`selectImportItemList` still shows the old status — unlike `/updateImportItem`, which is the one KRA's own
Go-Live dashboard actually tracks for this test case. Use `/updateImportItem`, not the "converted" alias.

## selectInvoiceDetail (Look Up Invoice Details)

No special payload gotchas — straightforward once you have a real `invcNo` from your own successful sale.

```
GET /oscu/sales/invoice-detail?merchantId=<id>&branchId=<sync2books branch id>&invcNo=<real invcNo>
```

Confirmed live 2026-08-12 with `resultCd: "000"` and the full `salesList[]` (receipt signature, item list,
tax breakdown) returned. This is the "Look Up Invoice Details" Go-Live test case — it was showing "Not
Executed" on the dashboard simply because no sale had ever succeeded yet to look up (same root dependency as
`sendSalesTransaction`/`saveItemComposition` — see the `insertStockIO` `bhfId` bug).

## saveItemComposition

`400 "Insufficient Stock" / "You dont have sufficient stock for this Transaction"` here just means the item
genuinely has no recorded stock at KRA yet (same dependency as `sendSalesTransaction`) — not a problem with
the composition request itself. Confirmed live 2026-08-12 with `resultCd: "000"` immediately after the
`insertStockIO` `bhfId` bug (see that section) was fixed and real stock existed for the item. If you hit
this, check whether `insertStockIO`/`saveStockMaster` actually succeeded for the item first, rather than
assuming your composition payload is wrong.

## sendPurchaseTransactionInfo / getPurchaseTransactionInfo (real 2-party flow, solved)

Per OSCU spec: "When a seller registers sales transaction and Invoice data to eTIMS Server, buyer can
request such data for purchase confirmation." This is genuinely a two-party confirmation, not a standalone
"record a purchase" call — you can't fabricate a `spplrTin`/`spplrInvcNo` and expect it to work
(`400 "Missing purchase Record" / "Supplier invoice number ... does not exist"`).

**KRA's sandbox seeds real, pre-existing sale records you can use** ("Completed by Automated User",
`spplrTin` typically another PIN under the same taxpayer). Fetch them first:

```json
POST /getPurchaseTransactionInfo
{"tin": "<Application Test Pin>", "bhfId": "00", "lastReqDt": "20180523000000"}
```
(`tin`/`bhfId` must be in the **body**, same as `selectStockMoveLists` — see the general note below.) Returns
`data.saleList[]`, each with a real `spplrTin`/`spplrInvcNo` and a real `itemList[]` (real `itemCd`,
`itemClsCd`, amounts).

Two more requirements once you have a real record to reference:

1. **The purchased item must already exist in *your own* item catalog** (`saveItem`'d under your own tin) —
   `400 "Item <code> provided on item: N. does not exist in your inventory. Ensure it is added under item
   management package"` if not. Register it with your own `itemCd`/`itemClsCd` (any valid classification you
   already have synced — the supplier's `itemClsCd` from the seed data may not be one you've synced
   yourself, so don't assume you can reuse it directly), and put the *supplier's* real code/name in
   `spplrItemCd`/`spplrItemClsCd`/`spplrItemNm` instead.
2. Amounts (`totItemCnt`, `taxblAmt*`, `totAmt`, etc.) must be internally consistent with whatever subset of
   the seller's `itemList` you reference — safest to reference exactly one item from the seed record and set
   totals to match just that one line, rather than trying to match a multi-item invoice exactly.
3. **`splyAmt` is tax-INCLUSIVE here too — same rule as `insertStockIO`/`sendSalesTransaction` (see
   `oscu-tax-rates.ts`), not the seed record's pre-tax `splyAmt`.** Confirmed live 2026-08-12: sending the
   seed's own `splyAmt`/`taxblAmt`/`taxAmt` values verbatim (e.g. seed had `splyAmt: 1122`, `totAmt: 1302.07`
   for a B-rate item) got rejected with `"Invalid splyAmnt on item: 1. Expected: 1302.07, But Found:
   1122.00"` — KRA wants `splyAmt = totAmt` (tax-inclusive), then `taxblAmt = round(splyAmt / 1.16, 2)` and
   `taxAmt = round(splyAmt - taxblAmt, 2)` derived from that, NOT copied from the seed item's own
   (differently-rounded) `taxblAmt`/`taxAmt` — a second attempt reusing the seed's `taxblAmt: 1122`/
   `taxAmt: 180.07` alongside the corrected `splyAmt` still got rejected (`"Invalid taxblAmt... Expected:
   1122.47, But Found: 1122.00"`) until they were recomputed from the corrected `splyAmt` directly.

```json
POST /sendPurchaseTransactionInfo
{
  "invcNo": 1, "orgInvcNo": 0,
  "spplrTin": "<real spplrTin from getPurchaseTransactionInfo>",
  "spplrBhfId": "00",
  "spplrNm": "<real spplrNm>",
  "spplrInvcNo": <real spplrInvcNo>,
  "regTyCd": "M", "pchsTyCd": "N", "rcptTyCd": "P", "pmtTyCd": "01", "pchsSttsCd": "02",
  "cfmDt": "yyyyMMddhhmmss", "pchsDt": "yyyyMMdd",
  "wrhsDt": null, "cnclReqDt": null, "cnclDt": null, "rfdDt": null,
  "totItemCnt": 1,
  "taxblAmtA": <matches the one line item's taxTyCd bucket>, "taxblAmtB": 0, "taxblAmtC": 0, "taxblAmtD": 0, "taxblAmtE": 0,
  "taxRtA": 0, "taxRtB": 16, "taxRtC": 0, "taxRtD": 0, "taxRtE": 0,
  "taxAmtA": 0, "taxAmtB": 0, "taxAmtC": 0, "taxAmtD": 0, "taxAmtE": 0,
  "totTaxblAmt": <same as taxblAmt bucket>, "totTaxAmt": <matches>, "totAmt": <matches>,
  "remark": null,
  "regrId": "sync2books", "regrNm": "sync2books", "modrId": "sync2books", "modrNm": "sync2books",
  "itemList": [{
    "itemSeq": 1,
    "itemCd": "<your own registered itemCd>",
    "itemClsCd": "<your own valid classification>",
    "itemNm": "<name>",
    "bcd": null,
    "spplrItemClsCd": "<supplier's real itemClsCd>",
    "spplrItemCd": "<supplier's real itemCd>",
    "spplrItemNm": "<supplier's real itemNm>",
    "pkgUnitCd": "NT", "pkg": 1, "qtyUnitCd": "NO", "qty": 1,
    "prc": <matches seed>, "splyAmt": <matches seed>, "dcRt": 0, "dcAmt": 0,
    "taxblAmt": <matches seed>, "taxTyCd": "<matches seed item's taxTyCd>", "taxAmt": <matches seed>,
    "totAmt": <matches seed>, "itemExprDt": null
  }]
}
```
Confirmed working live 2026-08-11 with `resultCd: "000"`, and reconfirmed live 2026-08-12 under a fresh
Application Test Pin (with the corrected tax-inclusive `splyAmt` math above — the 2026-08-11 pass apparently
used seed data where the pre-tax and post-tax numbers happened not to conflict, don't assume the seed's own
`splyAmt`/`taxblAmt` are safe to copy verbatim).

**No local persistence exists for purchases** (unlike sales, which has the full `ComplianceDocument`
lifecycle) — `sendPurchaseTransaction` in `oscu-operations.service.ts` is a raw pass-through, and only
`oscu_operation_logs` records the attempt. Building real purchase/bill tracking (mirroring the sales module)
is a separate feature, not something this endpoint needs for Go-Live certification purposes.

## A general pattern: some lookup/list endpoints need `tin`/`bhfId` in the body too

Confirmed for `selectStockMoveLists` and `getPurchaseTransactionInfo`: even though `tin`/`bhfId` are always
sent as headers, these two specific endpoints also require them duplicated in the JSON body, or they fail
with a misleading `400 "tin cannot be Null"` even though the header is clearly present. If you hit this
exact error on an endpoint not yet documented here, try adding `"tin"` and `"bhfId"` to the body first
before assuming something else is wrong.

**`selectStockMoveList` had this as a real app bug, now fixed** — its adapter method
(`etims-adapter.http.ts`) was running the request through `asJsonBody()`, which strips `tin`/`bhfId` for
integrator-style calls (correct for write endpoints, since they're already in the headers there). Fixed by
passing the request through untouched instead, matching how `getPurchaseTransactionInfo` (via
`postOscuEnvelope`) already worked. **Audit any other lookup endpoint that calls `asJsonBody()` directly for
the same bug** if you hit an empty/malformed response with no clear error message — check
`oscu_operation_logs` for a response with blank `resultCd`/`resultMsg` as the signature.

## initialize

```json
POST /initialize
{
  "tin": "<Application Test Pin>",
  "bhfId": "00",
  "dvcSrlNo": "<device serial>"
}
```
Note `tin`/`bhfId` must be in the **body** as well as the headers — a body with only `dvcSrlNo` fails with
`400 "Missing Tin" / "Tin cannot be empty"` even though `tin` is present in the request headers.

Success returns `cmcKey` and `deviceId` — store these; you should not need to call `/initialize` again for
this device+pin combination (see the device-corruption warning in `SKILL.md`).

## branchInsuranceInfo / branchUserAccount / branchSendCustomerInfo

All three need **both** `regrId`/`regrNm` (registrar) **and** `modrId`/`modrNm` (modifier) — sending only the
registrar pair fails with `400 "Request parameter error[<modrId> : may not be empty][<modrNm> : may not be
empty]"`. Confirmed live 2026-08-12; fixed by always sending all four (`modrId`/`modrNm` can just mirror
`regrId`/`regrNm` on first creation). `branchSendCustomerInfo` additionally rejects a null/empty `custTin`
(`400 "custTin cannot be empty or Null"`) even though the DTO/OSCU spec doesn't mark it required-looking —
always send a real-looking TIN string.

## selectCodeList

`resultCd: "001"` ("There is no search result") is a normal, expected response for an **incremental** pull
(`full` not set) once you've already done a full sync and nothing changed since — not a failure. This was a
real bug in `sync-code-list.usecase.ts` (fixed 2026-08-12): it unconditionally threw on any
`!envelope.success`, and since only `resultCd: "000"` counts as `success` in `postOscuEnvelope`, a legitimate
"nothing new" response surfaced as an **uncaught 500**, not a clean error. Fixed by special-casing
`resultCd === "001"` as a valid empty result. If you see a raw 500 (not a handled 400) from any `/catalog/*`
or `/oscu/*` sync route, check `oscu_operation_logs` for a `resultCd: "001"` first before assuming something
is actually broken — the same class of bug could exist in other sync usecases that haven't been audited yet.

## saveItem — `pkgUnitCd` allow-list is narrower than `selectCodeList`'s `useYn`

Confirmed 2026-08-25: `saveItem` rejects `pkgUnitCd: "BX"` ("Box") with `400 "The Package unit code can ony
be among the following list: [JY, KZ, LZ, NT, OU, PD, PG, PI, PO, PU, RL, RO, RZ, SK, TY, VG, VL, VO, VQ, VR,
AM, BA, BC, BE, BF, BG, BJ, BK, BL, BQ, BR, BV, BZ, CA, CH, CJ, CL, CR, CS, CT, CTN, CY, DR, GT, HH, IZ, JR,
JU, VT, VY, ML, TN]"` — 52 codes. But a full re-sync of `selectCodeList` (cdCls `17`, "Packing Unit") still
reports `BX` with `useYn: "Y"`, identical to before. **KRA's own reference-code lookup does not reflect
`saveItem`'s actual validation rule** — re-fetching `selectCodeList` will not surface this, since the
inconsistency is on KRA's sandbox side between two different endpoints, not stale local data.

Fixed locally by setting `useYn='N'` on the `oscu_codes` row for `(cdCls='17', cd='BX')` after confirming the
live rejection — `searchCodes()`/`GET /catalog/codes` already filters `useYn='Y'` by default, so this
immediately removes `BX` from the packaging-unit dropdown without touching sync logic. If a future
`selectCodeList` full re-sync runs again, it will re-upsert `BX` back to `useYn='Y'` (KRA's data, not ours) —
check this override still holds after any full codes resync, and re-apply if it got clobbered. If another
`pkgUnitCd` value gets accepted by `selectCodeList` but rejected by `saveItem` with the same "Package unit
code can ony be among the following list" error, add it here and disable it the same way rather than
re-debugging from scratch. For an item already assigned an `itemCd` with a bad code embedded, don't just
edit `packagingUnitCode` — the `itemCd`'s packaging slot (`itemCdSlice()` in `sync-items.usecase.ts`) must
also be regenerated to match, or `saveItem` fails again with `"Incorrect Packaging Unit Prefix"` even though
the real `pkgUnitCd` field is now valid.

## importedItemConvertedInfo — persistent `999` as of 2026-08-12

Previously documented as usually resolving on immediate retry (see the `insertStockIO` section's cross
reference). On 2026-08-12, 3 attempts across ~15 minutes, with two different real `taskCd` values from a
freshly-fetched `importedItemInfo` seed list, all got the identical `resultCd: "999" "There is an unknown
error. Please ask administrator"`. Payload was verified correct (`imptItemSttsCd: "3"` = "Approved", checked
against the cached `cdCls=26` code list). Didn't chase further this session — if you hit this, don't assume
it's a payload bug; try once or twice with a longer gap, and if it persists, treat it like the `insertStockIO`
issue (a KRA sandbox-side problem, not something fixable from our side).
