Subject: OSCU Go-Live sandbox (PIN P600004059A) — 4 endpoints fail with server-side NullPointerException (TestSessionApiLog is null), blocking certification

## URGENT — Go-Live certification session in progress, 1-hour clock running

## Account / environment (current Go-Live session, started 2026-07-31)

- Integrator PIN: P600004051A (company/vendor registration)
- Application Test Pin (tin used in all request headers/bodies): **P600004059A**
- Branch (bhfId): 00 (Headquarter)
- Sandbox base URL: https://sbx.kra.go.ke/etims-oscu/api/v1
- Apigee app id shown on Go-Live page: fd2eaf5d-e341-41f5-a6ac-1da6d869557e (we authenticated with our existing long-standing Apigee consumer key/secret, confirmed by you as unchanged across Go-Live sessions)
- Device serial (dvcSrlNo): JM9QLXNJ75 — `/initialize` succeeded cleanly this session, returned `cmcKey` and `deviceId 450471`
- Collection used: eTIMS-OSCU-Integrator-Automated-Testing-SBX (Gava Connect Postman collection) — all 23 endpoints tested exactly per that collection's request shapes/headers

## Summary

We are running the official 23-test-case Go-Live certification checklist. **19 of 23 endpoints work correctly**, several returning real account data (taxpayer name, branch, notices), proving our integration, auth, and headers are all correct. **4 endpoints consistently fail** with an HTTP 400 wrapping a server-side NullPointerException referencing `TestSessionApiLog`/`TestSessionApplicationStepDto` being null:

- `POST /selectItemClass`
- `POST /saveItem` — **blocks the required "Item Creation" certification screenshot**
- `POST /sendPurchaseTransactionInfo`
- `POST /sendSalesTransaction` — **blocks "Invoice Generation", "Invoice Copy", and "Credit Note" screenshots** (all three require an accepted sale)

This is the same bug pattern our team previously reported under a different test PIN (A009818366S) on 2026-07-24/27/28 — it has now reappeared under this freshly-issued Go-Live PIN (P600004059A), affecting 2 additional endpoints (`sendPurchaseTransactionInfo`, `sendSalesTransaction`) beyond the original two. **This blocks 4 of 4 required Go-Live evidence artifacts and threatens the certification window.**

Retried each failing call 2-3 times over ~1 minute with fresh OAuth tokens and varied payloads (different invoice numbers, item codes) — identical failure every time, ruling out a transient/token issue.

**Critically: we also tested against two more freshly-issued Application Test Pins during this same live session — `P600004062A` (rejected outright with `901 It is not valid device` for device `JM9QLXNJ75`, so untestable) and `P600004061A` (successfully initialized fresh, new `dvcId 450474`, new `mrcNo KRA00379349`) — and `selectItemClass`/`saveItem` failed with the byte-for-byte identical `TestSessionApiLog` NullPointerException on `P600004061A` too, despite it being a brand-new device/session initialized only minutes ago.** This strongly suggests the bug is **not scoped to a single PIN or test session** but is a systemic issue affecting these 4 endpoints across the sandbox right now.

## Working endpoints (proves auth/headers/request shape are correct)

All called with identical `tin: P600004059A` / `bhfId: 00` / `cmcKey` / `apigee_app_id` headers and a fresh Apigee OAuth bearer token:

- `POST /initialize` — success, cmcKey issued
- `POST /branchList` — returns our registered HQ branch (manager: Victor Wanjala Misiko)
- `POST /selectCodeList` — resultCd 000
- `POST /customerPinInfo` — resultCd 001 "no search result" (valid business response)
- `POST /selectTaxpayerInfo` — returns real taxpayer info ("Victor Wanjala Misiko")
- `POST /selectNoticeList` — returns live KRA notices
- `POST /importedItemInfo` — resultCd 000
- `POST /getPurchaseTransactionInfo` — resultCd 000
- `POST /selectSalesTransactions` — resultCd 001 (valid)
- `POST /selectStockMoveLists` — resultCd 001 (valid)
- `POST /itemInfo` — resultCd 001 (valid)
- `POST /branchInsuranceInfo` — resultCd 000
- `POST /branchUserAccount` — resultCd 000
- `POST /branchSendCustomerInfo` — resultCd 000
- `POST /selectInvoiceDetail` — resultCd 001 (valid)
- `POST /importedItemConvertedInfo` — reaches real business validation ("taskCd not found") — endpoint healthy
- `POST /saveItemComposition` — reaches real business validation ("inventory empty, add item first") — endpoint healthy
- `POST /insert/stockIO` — reaches real business validation ("itemCd does not exist") — endpoint healthy
- `POST /save/stockMaster` — reaches real business validation ("itemCd does not exist") — endpoint healthy

## Failing endpoints — this session's evidence

### POST /selectItemClass
Request: `{"tin":"P600004059A","bhfId":"00","lastReqDt":"20180523000000"}`
responseRefID: `603d37c8-a7da-49dd-9fcd-5edf84e58aaa`

### POST /saveItem
Request: valid item payload, itemCd `KE2NTBA16861153` (formula-generated per your Postman example), itemClsCd `5059690800` (a real, currently-valid code)
responseRefID: `fba051a0-08e6-404a-8f20-40b3c08ecfac` (+ 3 further retries, identical error, different responseRefIDs)
```json
{
  "responseHeader": {
    "responseCode": 400,
    "customerMessage": " Error: ",
    "debugMessage": "Cannot invoke \"com.safaricom.dxl.etimsautomations.models.entities.TestSessionApiLog.getApiNo()\" because the return value of \"com.safaricom.dxl.etimsautomations.models.dto.TestSessionApplicationStepDto.getTestSessionApiLog()\" is null"
  },
  "responseBody": null
}
```

### POST /sendPurchaseTransactionInfo
Request: sample purchase payload per your Postman collection
responseRefID: `149b71e3-7560-4b38-a780-f02af5a54490`

### POST /sendSalesTransaction
Request: valid sale payload (itemCd `KE2NTBA00000001`, standard sample item)
responseRefID: `067775b0-a265-4b5d-8a11-7f7b80597070` (+1 further retry with different invcNo, identical error)
```json
{
  "responseHeader": {
    "responseCode": 400,
    "customerMessage": "Expected a value but found null. Check your payload and try again",
    "debugMessage": "Expected a value but found null. Possible cause: Cannot invoke \"ke.go.kra.etims.etimsautomations.models.entities.TestSessionApiLog.getApiNo()\" because the return value of \"ke.go.kra.etims.etimsautomations.models.dto.TestSessionApplicationStepDto.getTestSessionApiLog()\" is null"
  },
  "responseBody": null
}
```

## Why we believe this is server-side

- 19/23 endpoints work correctly with identical headers/auth against the same session — rules out our request shape, headers, or credentials as the cause.
- The exact same null-reference pattern (`TestSessionApiLog` via `TestSessionApplicationStepDto`) appears across 4 endpoints spanning two different backend packages (`ke.go.kra.etims.etimsautomations...` and `com.safaricom.dxl.etimsautomations...`), pointing to a shared upstream test-session provisioning gap rather than 4 unrelated bugs.
- This is the second time we've hit this exact bug class, now under a newly-issued Go-Live PIN, with 2 more endpoints affected than before.

## Impact

All 4 required Go-Live evidence screenshots (Item Creation, Invoice Generation, Invoice Copy, Credit Note) are currently unreachable because `saveItem` and `sendSalesTransaction` are both blocked. This stops certification entirely despite the rest of our integration being fully verified and working.

## Ask

Please check why `TestSessionApiLog`/`TestSessionApplicationStepDto` resolves to null for PIN P600004059A on `selectItemClass`, `saveItem`, `sendPurchaseTransactionInfo`, and `sendSalesTransaction` specifically, and what needs to be provisioned on your side to unblock these 4 operations. **We are inside the live 1-hour Go-Live test window and need this resolved urgently** — happy to provide additional trace IDs or retry immediately once addressed.
