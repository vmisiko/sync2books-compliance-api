Subject: `/insertStockIO` (Save Stock In/Out) consistently rejected with "Error occurred while validating item tax type: Please try again later" — reproduced on 6 distinct items, 2 tax types, 2 Apigee apps

## Account / environment

- Apigee App ID: `0ada03d4-8b15-4c51-9a6b-7bdbe8ce2e78` (also reproduced under the previous app, `e0c07d61-386c-4628-8378-3a2874f14cc0`)
- Application Test Pin: `P600004152A`
- Device serial (`dvcSrlNo`): `JM9QLXNJ75`
- Sandbox base URL: `https://sbx.kra.go.ke/etims-oscu/api/v1`
- Branch (bhfId): `00` (Headquarter)

## Summary

Every `/insertStockIO` call we've made under this Application Test Pin — across 6 different items, spanning
several minutes to over half an hour of retries — fails identically with:

> `responseCode 400`, `customerMessage: "Validation failed"`, `debugMessage: "Error occurred while
> validating item tax type: Please try again later"`

This is blocking Go-Live certification's "Save Stock In/Out" test case, and transitively blocks
`sendSalesTransaction` (rejected with `"Items provided under the itemList section do not exist in your
stock"`, since our stock was never recorded on your side) and `saveItemComposition` (rejected with
`"You dont have sufficient stock for this Transaction"`, same root cause).

## Why we believe this is server-side, not a payload issue

We deliberately varied every request dimension we control to rule out a client-side cause before escalating:

1. **Tax type**: tried `taxTyCd: "B"` (16% standard rate, `itemClsCd: "1010150100"`) and `taxTyCd: "C"`
   (zero-rated, `itemClsCd: "9901200000"`) — identical failure both times, ruling out any
   tax-type/classification cross-validation as the cause.
2. **Quantity/packaging unit codes**: `qtyUnitCd: "NO"` and `pkgUnitCd: "NT"`, both independently confirmed
   valid against your own `selectCodeList` response for `cdCls=10` (Quantity Unit) and `cdCls=17` (Packing
   Unit).
3. **Item freshness**: every item was registered seconds to minutes earlier via `saveItem` with
   `resultCd: "000"` — ruling out a registration-propagation delay.
4. **Two different Apigee apps** (we registered a new app same-day to resolve an unrelated device-corruption
   issue) — the error reproduces identically under both.
5. **HTTP status is 400 with a real OSCU business-validation message**, not a 401/403 gateway rejection —
   confirming the request reaches your OSCU business logic rather than failing at an API-product/entitlement
   check.

## Evidence (most recent attempt)

Request:
```json
{
  "sarNo": 7, "orgSarNo": null, "regTyCd": "M", "custTin": null, "custNm": null, "custBhfId": null,
  "sarTyCd": "05", "ocrnDt": "20260812", "totItemCnt": 1,
  "totTaxblAmt": 5000, "totTaxAmt": 0, "totAmt": 5000,
  "remark": "MANUAL_ADJUST",
  "regrId": "sync2books", "regrNm": "sync2books", "modrId": "sync2books", "modrNm": "sync2books",
  "itemList": [{
    "itemSeq": 1, "itemCd": "KE2NTNO0000005", "itemClsCd": "9901200000",
    "itemNm": "Zero Rated Test Item", "bcd": null, "pkgUnitCd": "NT", "pkg": 50,
    "qtyUnitCd": "NO", "qty": 50, "itemExprDt": null, "prc": 100, "splyAmt": 5000,
    "totDcAmt": 0, "taxblAmt": 5000, "taxTyCd": "C", "taxAmt": 0
  }]
}
```

Response:
```json
{
  "responseHeader": {
    "responseCode": 400,
    "responseRefID": "2642dd86-7e97-436f-8192-bd2b78df2f2b",
    "customerMessage": "Validation failed",
    "debugMessage": "Error occurred while validating item tax type: Please try again later"
  },
  "responseBody": null
}
```

Item `KE2NTNO0000005` was registered successfully seconds before this attempt (`saveItem` → `resultCd:
"000"`).

## Ask

1. Please check server-side logs for `responseRefID: 2642dd86-7e97-436f-8192-bd2b78df2f2b` (and, if useful,
   `ea17728b-805a-4d3f-ab83-65e66f834f8b` from an earlier attempt in the same session) to identify what's
   failing in the item-tax-type validation step for `/insertStockIO`.
2. Please confirm whether this is a known sandbox degradation and, if so, an ETA for resolution — this is the
   sole remaining blocker for 3 of our 23 Go-Live test cases (Save Stock In/Out, and transitively Invoice
   Generation and Save Item Composition, since neither can produce evidence without recorded stock).
3. Happy to provide additional trace IDs or a call if that's faster.
