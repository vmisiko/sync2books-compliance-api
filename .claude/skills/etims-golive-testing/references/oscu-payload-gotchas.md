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

## insertStockIO

Confirmed the OSCU spec/DTO naming is misleading here: transaction-level fields belong at the **request
root**, not nested inside each `itemList[]` entry (a request with them only nested gets
`400 "regTyCd cannot be null"`). `ocrnDt` here is **8-digit `yyyyMMdd`**, not the 14-digit
`yyyyMMddhhmmss` used elsewhere. `orgSarNo` must be a real integer (`0` for a first entry) — sending `null`
(which is what its type signature implies is fine) causes a Java NPE-style error:
`"Cannot invoke Integer.intValue() because ... getOrgSarNo() is null"`. `sarNo` needs the same
strictly-incrementing-from-1 treatment as `itemCd`'s sequence, scoped per tin.

Amounts cannot be a literal `0` — KRA rejects with `400 "Expected a value for totAmt... but it is empty or
null"` (0 is apparently indistinguishable from "empty" to their validator). Use real tax-inclusive math:
given a tax-inclusive total `T` and 16% VAT (`taxTyCd: "B"`):
```
taxblAmt = T / 1.16
taxAmt   = T - taxblAmt
```
Same rule for `pkg` as `sendSalesTransaction` below — a real count, not `0`.

The app's automatic sync (`InventoryService.syncStockMovementToEtims()`, triggered by `ETIMS_STOCK_SYNC=true`
on `recordMovement()`/`adjustStock()`/`transferStock()`) implements exactly this — fixed 2026-08-11. It needs
a `unitPrice` (pass it to `PUT /api/stock/adjust` / `POST /api/stock/transfer`) to compute `splyAmt`/
`taxblAmt`/`taxAmt`; without one it now logs a `WARN` and skips the call rather than sending a doomed
zero-amount request (previously it always sent one and always got rejected).

```json
POST /insert/stockIO
{
  "sarNo": 1,
  "orgSarNo": 0,
  "regTyCd": "M",
  "custTin": null, "custNm": null, "custBhfId": null,
  "sarTyCd": "02",
  "ocrnDt": "20260811",
  "totItemCnt": 1,
  "totTaxblAmt": 8620.69,
  "totTaxAmt": 1379.31,
  "totAmt": 10000,
  "remark": "Initial stock",
  "regrId": "sync2books", "regrNm": "sync2books", "modrId": "sync2books", "modrNm": "sync2books",
  "itemList": [
    {
      "itemSeq": 1,
      "itemCd": "KE2NTNO0000001",
      "itemClsCd": "1010150000",
      "itemNm": "Test Item",
      "bcd": null,
      "pkgUnitCd": "NT",
      "pkg": 100,
      "qtyUnitCd": "NO",
      "qty": 100,
      "itemExprDt": null,
      "prc": 100,
      "splyAmt": 10000,
      "totDcAmt": 0,
      "taxblAmt": 8620.69,
      "taxTyCd": "B",
      "taxAmt": 1379.31
    }
  ]
}
```
`sarTyCd` codes (OSCU code classification 12): incoming `01` import, `02` purchase, `03` return, `04` stock
movement, `05` adjustment, `06` processing; outgoing `11` sale, `12` return, `13` stock movement,
`14` processing, `15` discarding, `16` adjustment.

**Status as of 2026-08-11: payload/code confirmed correct, but no live `resultCd: "000"` yet obtained.**
Every attempt (across 3 different items, including two freshly registered with `resultCd: "000"` on
`saveItem` moments earlier) got the exact same `400`:
`"Error occurred while validating item tax type: Please try again later"` — reproduced consistently over a
~10 minute window, not a one-off. Since it reproduces identically on brand-new items right after a successful
registration, and the message is KRA's own "try again later" wording (not a validation complaint about the
payload shape), this looks like a KRA sandbox-side degradation in their item-tax-type-validation service
specifically for `insertStockIO`, not a client bug — but it hasn't been proven to *always* be transient the
way `importedItemConvertedInfo`'s "999 unknown error" was (that one resolved on immediate retry; this one
didn't resolve across ~10 minutes of retries). If you hit this again: confirm the item really did register
(`resultCd: "000"` on `saveItem`/`items/sync`), then retry `insertStockIO` after a longer wait (many minutes,
not seconds) before assuming it's a new payload bug.

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

**Even after both of these return `resultCd: "000"`**, `sendSalesTransaction` for that item can persistently
fail with `"Items provided under the itemList section do not exist in your stock"` for no apparent reason,
no matter how many times you re-register stock or how long you wait. **We eventually confirmed this is not a
propagation-lag issue — it's the same session/device corruption class of bug as the `/initialize` "2 results
were returned" error** (see the device-corruption section in `SKILL.md`). It went away immediately after
switching to a brand-new Apigee app (new consumer key/secret + new App ID) for the *same* device serial and
pin — nothing about the request payload changed. If you hit this and stock registration is genuinely
confirmed successful, don't keep tweaking the payload: register a new Apigee app instead (see SKILL.md).

## sendSalesTransaction

Confirmed working end-to-end 2026-08-11 (real `ACCEPTED` response with a live `receiptSignature` and
`etimsUrl`) after fixing four separate bugs, all present in the "obvious" version of this request:

1. **`pkg` must be a real package count, not `0`.** `400 "Invalid pkg for ItemList 1. Expected: 1, Found: 0"`.
   Use `pkg: quantity` (matches the pattern used elsewhere when packaging isn't separately modeled).
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

## saveItemComposition

`400 "Insufficient Stock"` here was a symptom of the same messy/corrupted session state as the
`sendSalesTransaction` stock issue above, not a real problem with the composition request itself — it
started returning `resultCd: "000"` cleanly once the underlying item had a clean, correctly-tracked stock
trail (after switching Apigee apps). If you hit this, don't assume your composition payload is wrong; check
whether `sendSalesTransaction` is also stuck on the same phantom "stock doesn't exist" issue first.

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
Confirmed working live 2026-08-11 with `resultCd: "000"`.

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
