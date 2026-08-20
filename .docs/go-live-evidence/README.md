# KRA eTIMS OSCU Go-Live Evidence — Sync2Books

**Session date:** 2026-08-20
**Result:** 23/23 test cases passed

## Credentials used this session

| Field | Value |
|---|---|
| Apigee App ID | `057e4084-15d0-4336-a7f7-b24afc00f8b4` |
| Application Test Pin | `P600004185A` |
| Integrator Pin | `P600004165A` |
| Device Serial (dvcSrlNo) | `JM9QLXNJ75` |
| Branch Id (bhfId) | `00` |
| eTIMS Solution | OSCU |
| Type of Integrator | SELF |
| Trader Invoicing System | Sync2Books compliance, v1.0 |

## How to use this folder

- Drop your dashboard screenshots into `screenshots/` (name them e.g. `01-oscu-initialization.png`,
  `02-look-up-list-of-code.png`, ... matching the numbering below, or just `item-creation.png` /
  `invoice-generation.png` for 2 of the 4 required Go-Live artifacts).
- `screenshots/invoice-copy.pdf` and `screenshots/credit-note-copy.pdf` are already in this folder — the
  other 2 required artifacts, generated directly (see below).

### Where invoice-copy.pdf / credit-note-copy.pdf came from

The `etimsUrl` our own `sales.service.ts` constructs (`https://etims.kra.go.ke/common/link/etims/receipt/
indexEtimsReceptData?{...}`) is **not a real, verified KRA endpoint** — it 404s on both the production host
and the `etims-sbx.kra.go.ke` sandbox variant. It looks like a guessed/placeholder URL format that was never
confirmed against KRA's real receipt-verification portal; don't rely on it for evidence, and don't assume
fixing the host would make it work without further investigation.

Instead, use the project's own working receipt PDF generator:

```bash
curl -s "http://localhost:3001/api/sales/<url-encoded-document-id>/receipt" -o invoice-copy.pdf
```

`<document-id>` is the `id` field from the sale/credit-note's `integrationResponse` (see `sync_items` in the
main API DB, or the response of the original `POST .../sales` / `.../credit-notes/express` call) — e.g.
`doc-e8a7bf61-7326-45cc-8d32-70f1278f572c:GOLIVE-INV-001:SALE-1787220030156`. This renders a genuine PDF
with the KRA PIN, branch, device, receipt number, signature, and a scannable QR code — confirmed working
live 2026-08-20 for both the invoice and the credit note.
- This `README.md` is the narrative evidence record: every test case below is backed by the **actual raw
  KRA sandbox response** captured live during this session — receipt numbers, signatures, timestamps,
  resultCd/resultMsg — not just a passing dashboard badge (the dashboard is known to lag behind real
  results in this project — see `sync2books-compliance-api/.claude/skills/etims-golive-testing/SKILL.md`).

## Summary — all 23 test cases

| # | Test Case | Endpoint | Status | Key evidence |
|---|---|---|---|---|
| 1 | OSCU INITIALIZATION | `/selectInitOsdcInfo` | ✅ Passed | Real `cmcKey` issued: `FF37B2FC315D4F8A96347D1C7A22F5F5EE7999B76D4E42B4B09E`, `deviceId: 450682` |
| 2 | LOOK UP LIST OF CODE | `/selectCodeList` | ✅ Passed | 755 codes synced across 21 code groups |
| 3 | LOOK UP ITEM CLASSIFICATION | `/selectItemClsList` | ✅ Passed | 26 classifications synced |
| 4 | LOOK UP BRANCH LIST | `/selectBhfList` | ✅ Passed | `resultCd 000`, real registered branch "Headquarter", Bungoma, manager Victor Wanjala Misiko |
| 5 | LOOK UP NOTICES LIST | `/selectNoticeList` | ✅ Passed | `resultCd 000`, 5 live KRA notices returned |
| 6 | SAVE CUSTOMER BRANCH | `/saveBhfCustomer` | ✅ Passed | `resultCd 000` |
| 7 | SAVE BRANCH USER ACCOUNT | `/saveBhfUser` | ✅ Passed | `resultCd 000` |
| 8 | SAVE BRANCH INSURANCES | `/saveBhfInsurance` | ✅ Passed | `resultCd 000` |
| 9 | LOOK UP PRODUCT LIST | `/itemInfo` (`selectItemList`) | ✅ Passed | `resultCd 000` once item registered — see #10 |
| 10 | SAVE ITEM | `/saveItem` | ✅ Passed | `resultCd 000`, `itemCd: KE2NTNO0000001` — **Item Creation evidence** |
| 11 | SAVE ITEM COMPOSITION | `/saveItemComposition` | ✅ Passed | `resultCd 000` |
| 12 | LOOK UP IMPORTED ITEM LIST | `/selectImportItemList` | ✅ Passed | `resultCd 000`, real seeded import record (`taskCd 20230209030466`, LIFTING BELTS, supplier SEITZ GMGH) |
| 13 | UPDATE IMPORTED ITEMS | `/updateImportItem` | ✅ Passed | `resultCd 000` |
| 14 | SAVE SALES TRANSACTION | `/saveTrnsSalesOsdc` (`sendSalesTransaction`) | ✅ Passed | `complianceStatus: ACCEPTED`, `invcNo: 1`, receipt signature `IIH72PTHKSZHT2E5` — **Invoice Generation evidence** |
| 15 | LOOK UP PURCHASES-SALES LIST | `/selectTrnsPurchaseSalesList` | ✅ Passed | `resultCd 000`, real seeded purchase/sale records from supplier P600004165A |
| 16 | SAVE PURCHASES INFORMATION | `/insertTrnsPurchase` | ✅ Passed | `resultCd 000` |
| 17 | SAVE STOCK-MASTER INFORMATION | `/saveStockMaster` | ✅ Passed | `resultCd 000` (real `save/stockMaster` call, `rsdQty: 120`) |
| 18 | LOOK UP STOCK MOVEMENT | `/selectStockMoveList` | ✅ Passed | `resultCd 001` (valid "no result" business response) |
| 19 | SAVE STOCK IN/OUT | `/insertStockIO` | ✅ Passed | `resultCd 000` (real `insert/stockIO` call) |
| 20 | LOOK UP INVOICE DETAILS | `/selectInvoiceDetails` | ✅ Passed | `resultCd 000`, full `salesList[]` with receipt signature `IIH72PTHKSZHT2E5` — **Invoice copy evidence** |
| 21 | LOOK UP TRANSACTION SALES LIST | `/selectTrnsSalesList` | ✅ Passed | `resultCd 000` |
| 22 | LOOK UP CUSTOMER LIST | `/selectCustomerList` | ✅ Passed | `resultCd 000`, `custNo: CUST001` |
| 23 | LOOK UP TAX PAYER INFO | `/selectTaxPayerInfo` | ✅ Passed | `resultCd 000`, `taxprNm: Victor Wanjala Misiko` |
| + | Credit Note (express) | `/sendSalesTransaction` (receiptTypeCode `R`) | ✅ Passed | `status: completed`, receipt signature `K33QUGLRLVTHANCD`, references original sale — **Credit Note evidence** |

## The 4 required Go-Live evidence artifacts — detail

### 1. Item Creation

```json
POST /saveItem -> resultCd: "000", resultMsg: "Successful"
itemCd: "KE2NTNO0000001"
itemNm: "Go Live Test Item 2"
itemClsCd: "1010150000"
```

### 2. Invoice Generation

```json
POST /saveTrnsSalesOsdc (sendSalesTransaction) -> resultCd: "000", resultMsg: "Successful"
invcNo: 1
curRcptNo: 1
rcptSign: "IIH72PTHKSZHT2E5"
sdcDateTime: "20260820130032"
totAmt: 100
traderInvoiceNumber: "GOLIVE-INV-001"
complianceStatus (our system): ACCEPTED
```

**Note on the dashboard screenshot for this test case:** the KRA Go-Live dashboard's `SAVE SALES TRANSACTION`
row captures whichever `/saveTrnsSalesOsdc` call happened *most recently* — since the Credit Note (below)
was submitted after this invoice, the row's "Full JSON Details" popup shows the credit note's receipt
(`curRcptNo: 2`, `rcptSign: "K33QUGLRLVTHANCD"`) rather than this invoice's. Both are genuine successful
calls to the same endpoint — the test case correctly shows "Passed" either way. This invoice's own receipt
data (`curRcptNo: 1`, `rcptSign: "IIH72PTHKSZHT2E5"`) is recorded above and in the "Invoice Copy" section
below for the record.

### 3. Invoice Copy

```json
GET /selectInvoiceDetail?invcNo=1 -> resultCd: "000"
Same receipt: rcptSign "IIH72PTHKSZHT2E5", curRcptNo "1", totRcptNo "1"
Full itemList[] and tax breakdown returned (taxTyCd B, taxblAmt 86.21, taxAmt 13.79)
```

### 4. Credit Note

```json
POST /sendSalesTransaction (receiptTypeCode: R, express credit note) -> status: "completed"
receiptSignature: "K33QUGLRLVTHANCD"
receiptNumber: 2
originalSaleId: "doc-e8a7bf61-7326-45cc-8d32-70f1278f572c:GOLIVE-INV-001:SALE-1787220030156"
traderInvoiceNumber: "GOLIVE-CN-001"
```

## Notes for the Go-Live application reviewer

- All 23 test cases and all 4 required evidence artifacts were completed in a single continuous session
  against `https://sbx.kra.go.ke/etims-oscu/api/v1` under Apigee App ID `057e4084-15d0-4336-a7f7-b24afc00f8b4`.
- Test case #13 (UPDATE IMPORTED ITEMS) initially failed with a generic KRA-side error
  (`resultCd 999 "unknown error"`); root cause was isolated to the `remark` field needing a non-empty string
  rather than `null` specifically on the Approve (`imptItemSttsCd: 3`) transition. Fixed and reconfirmed
  live with `resultCd 000`.
- Full technical debugging trail (payload shapes, KRA sandbox quirks) is preserved in
  `sync2books-compliance-api/.claude/skills/etims-golive-testing/references/oscu-payload-gotchas.md` for
  audit/reference purposes.
