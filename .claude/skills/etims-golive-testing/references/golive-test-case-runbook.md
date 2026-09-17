# Go-Live Test Case Runbook — all 23 dashboard rows

Every row on the developer.go.ke test-case dashboard, mapped to the exact call that passes it. All 23 were
run green on 2026-09-17 (new THIRDPARTY app, pin `P600004555A`, device `SYNCP052581715V`). Payload details
and failure modes live in `oscu-payload-gotchas.md`; this file is the "what to call, in what order" list.

Set these first:

```bash
B=http://localhost:3001                       # compliance-api
M=<sync2books company id>                     # = compliance merchantId, e.g. 580e7da6-f713-4277-8eae-389215afcd17
Q="merchantId=$M&branchId=00&lastReqDt=20200101000000"
REG='"regrId":"<user id>","regrNm":"<user name>","modrId":"<user id>","modrNm":"<user name>"'
```

A pass is `rawResponse.resultCd == "000"` (or `"001"` "no search result" for a lookup). Don't trust the HTTP
status or the dashboard badge — see `SKILL.md`.

## Order (dependencies first)

| # | Dashboard row | KRA path | How we call it | Depends on |
|---|---|---|---|---|
| 1 | OSCU INITIALIZATION | `/selectInitOsdcInfo` | main API `POST /companies/$M/integrations/etims/provision` — **once per device** | — |
| 2 | LOOK UP LIST OF CODE | `/selectCodeList` | `POST $B/catalog/codes/sync` `{"merchantId","branchId":"00","full":true}` (**not** `/catalog/code-list/sync` — 404) | 1 |
| 3 | LOOK UP ITEM CLASSIFICATION | `/selectItemClsList` | `POST $B/catalog/item-classifications/sync` `{…,"full":true}` | 1 |
| 4 | LOOK UP BRANCH LIST | `/selectBhfList` | `GET $B/oscu/branches?$Q` | 1 |
| 5 | LOOK UP NOTICES LIST | `/selectNotices` | `GET $B/oscu/notices?$Q` | 1 |
| 6 | SAVE CUSTOMER BRANCH | `/saveBhfCustomer` | `POST $B/oscu/branches/customer` — see below | 1 |
| 7 | SAVE BRANCH USER ACCOUNT | `/saveBhfUser` | `POST $B/oscu/branches/user-account` — see below | 1 |
| 8 | SAVE BRANCH INSURANCES | `/saveBhfInsurance` | `POST $B/oscu/branches/insurance` — see below | 1 |
| 10 | SAVE ITEM | `/saveItem` | main API `POST …/etims/catalog/items` then `POST …/catalog/items/sync` | 3 |
| 9 | LOOK UP PRODUCT LIST | `/selectItemList` | `GET $B/oscu/items/info?$Q` | 10 |
| 19 | SAVE STOCK IN/OUT | `/insertStockIO` | `PUT $B/api/stock/adjust` **with `unitPrice`** | 10 |
| 17 | SAVE STOCK-MASTER INFORMATION | `/saveStockMaster` | same call as 19 (`ETIMS_STOCK_MASTER_SYNC=true`) | 10 |
| 18 | LOOK UP STOCK MOVEMENT | `/selectStockMoveList` | `GET $B/oscu/stock/movements?$Q` | — |
| 11 | SAVE ITEM COMPOSITION | `/saveItemComposition` | `POST $B/oscu/items/composition` — see below | 10, 19 |
| 12 | LOOK UP IMPORTED ITEM LIST | `/selectImportItemList` | `GET $B/oscu/imported-items?$Q` | 1 |
| 13 | UPDATE IMPORTED ITEMS | `/updateImportItem` | `POST $B/oscu/imported-items/convert` — see below | 10, 12 |
| 14 | SAVE SALES TRANSACTION | `/saveTrnsSalesOsdc` | main API `POST …/etims/sales?submit=true` | 10, 19 |
| 20 | LOOK UP INVOICE DETAILS | `/selectInvoiceDetails` | `GET $B/oscu/sales/invoice-detail?merchantId=$M&branchId=00&invcNo=<accepted invcNo>` | 14 |
| 21 | LOOK UP TRANSACTION SALES LIST | `/selectTrnsSalesList` | `GET $B/oscu/sales/transactions?$Q` | 14 |
| 15 | LOOK UP PURCHASES-SALES LIST | `/selectTrnsPurchaseSalesList` | `GET $B/oscu/purchases?$Q` | 1 |
| 16 | SAVE PURCHASES INFORMATION | `/insertTrnsPurchase` | `POST $B/oscu/purchases` — see below | 10, 15 |
| 22 | LOOK UP CUSTOMER LIST | `/selectCustomerList` | `GET $B/oscu/customers?$Q` | 6 |
| 23 | LOOK UP TAX PAYER INFO | `/selectTaxPayerInfo` | `GET $B/oscu/taxpayer-info?$Q` | 1 |

The eight plain lookups (4, 5, 9, 12, 15, 18, 20–23) need nothing beyond the query string.

## Write payloads that passed (2026-09-17)

Use realistic values — these records are visible to the reviewer (see `golive-resubmission-dataset.md` §2).

**6 — SAVE CUSTOMER BRANCH.** `custTin` must be non-empty; all four regr/modr fields required.
```json
{"merchantId":"$M","branchId":"00","custNo":"C0001","custTin":"P052581715V","custNm":"Amani Business Park Ltd",
 "adrs":"Waiyaki Way, Nairobi","telNo":"0733221100","email":"accounts@amanibusinesspark.co.ke","faxNo":null,
 "useYn":"Y","remark":"Corporate account", REG}
```

**7 — SAVE BRANCH USER ACCOUNT.** `pwd` is a branch-user password stored at KRA — generate a throwaway
(`openssl rand -hex 8`), never reuse a real one, never commit it.
```json
{"merchantId":"$M","branchId":"00","userId":"frontdesk01","userNm":"Front Desk Cashier","pwd":"<random>",
 "adrs":"Jamhuri, Langata District, Nairobi","cntc":"0721649416","authCd":null,"remark":"Headquarter cashier",
 "useYn":"Y", REG}
```

**8 — SAVE BRANCH INSURANCES.** Fictional insurer (don't name a real one).
```json
{"merchantId":"$M","branchId":"00","isrccCd":"SHI001","isrccNm":"Savannah Health Insurance","isrcRt":20,"useYn":"Y", REG}
```

**11 — SAVE ITEM COMPOSITION.** The parent `itemCd` must be a **goods** item — a service parent fails with
*"You cannot create an service using an item"*. The component needs KRA stock. Passed with Dawa Cocktail
(`KE2NTNO0000001`) ← Wild Honey 500g Jar (`KE2NTNO0000014`, registered + 20 stocked for this purpose):
```json
{"merchantId":"$M","branchId":"00","itemCd":"KE2NTNO0000001","cpstItemCd":"KE2NTNO0000014","cpstQty":1,
 "regrId":"<user id>","regrNm":"<user name>"}
```

**13 — UPDATE IMPORTED ITEMS.** `taskCd`/`dclDe`/`itemSeq`/`hsCd` from row 12's response; your own registered
`itemCd` + a synced `itemClsCd`; `remark` non-null. Integrator mode already routes to `/updateImportItem`.
```json
{"merchantId":"$M","branchId":"00","taskCd":"20230209030827","dclDe":"01022023","itemSeq":1,"hsCd":"63079000",
 "itemClsCd":"1000000000","itemCd":"KE2BGPA0000012","imptItemSttsCd":"3","remark":"Approved after customs clearance",
 "modrId":"<user id>","modrNm":"<user name>"}
```

**16 — SAVE PURCHASES INFORMATION.** Must reference a real sale from row 15 (the sandbox seeds 5 supplier
invoices under the integrator PIN). Pick a single **zero-rated or exempt** line so there is no VAT rounding to
match; map it to your own item with the same `taxTyCd`. `invcNo` is your own purchase counter (1 on a fresh
PIN). Passed with supplier invoice 1, line Product-C-3 (C, 3670.66) → Farm Fresh Milk:
```json
{"merchantId":"$M","branchId":"00","invcNo":1,"orgInvcNo":0,"spplrTin":"P052581715V","spplrBhfId":"00",
 "spplrNm":"SYNC TO BOOKS RECONCILER LIMITED","spplrInvcNo":1,"regTyCd":"M","pchsTyCd":"N","rcptTyCd":"P",
 "pmtTyCd":"01","pchsSttsCd":"02","cfmDt":"<yyyyMMddhhmmss now>","pchsDt":"<yyyyMMdd>","wrhsDt":null,
 "cnclReqDt":null,"cnclDt":null,"rfdDt":null,"totItemCnt":1,
 "taxblAmtA":0,"taxblAmtB":0,"taxblAmtC":3670.66,"taxblAmtD":0,"taxblAmtE":0,
 "taxRtA":0,"taxRtB":16,"taxRtC":0,"taxRtD":0,"taxRtE":0,
 "taxAmtA":0,"taxAmtB":0,"taxAmtC":0,"taxAmtD":0,"taxAmtE":0,
 "totTaxblAmt":3670.66,"totTaxAmt":0,"totAmt":3670.66,"remark":null, REG,
 "itemList":[{"itemSeq":1,"itemCd":"KE2NTNO0000011","itemClsCd":"9901200000","itemNm":"Farm Fresh Milk 500ml",
   "bcd":null,"spplrItemClsCd":"5059690800","spplrItemCd":"KE1NTXU1000003","spplrItemNm":"Product-C-3",
   "pkgUnitCd":"NT","pkg":1,"qtyUnitCd":"NO","qty":1,"prc":3670.66,"splyAmt":3670.66,"dcRt":0,"dcAmt":0,
   "taxblAmt":3670.66,"taxTyCd":"C","taxAmt":0,"totAmt":3670.66,"itemExprDt":null}]}
```
For a B-rate line instead, `splyAmt = totAmt` (tax-inclusive) and recompute `taxblAmt`/`taxAmt` from it —
never copy the seed's own `splyAmt`.
