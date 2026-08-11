Subject: OSCU sandbox — "Query did not return a unique result: 2 results were returned" blocking /initialize on THREE different PINs in a row, all device serial JM9QLXNJ75 — please issue a new device serial or clean up server-side session state

**Update 1:** we also tried the PIN provided via your SMS reply (`P600004140A`, "PLEASE USE P600004140A, BRANCH ID 00 AND DEVICE SERIAL NUMBER JM9QLXNJ75 TO INITIALIZE YOUR DEVICE"). It fails with the *exact same error* as the two PINs before it. This is now the third distinct Application Test Pin to hit this identical failure against device serial `JM9QLXNJ75` — strong confirmation the issue is scoped to the device serial itself, not any particular PIN. Per KRA's own registration rules, we understand the device serial cannot be changed by us and requires KRA to issue a new one (in person or otherwise) — please advise if that's the fix, or if there's a server-side cleanup that resolves this without a new device serial.

**Update 2 — important, please read before responding:** we started a fourth session via the "Start Test" page, which issued a fourth new Application Test Pin, `P600004146A`, for the same device serial. `/initialize` failed again — but this time the message changed from **"2 results were returned" to "3 results were returned."** The ambiguity count is going *up by one* with each fresh-PIN `/initialize` attempt. This is direct evidence that every `/initialize` call adds another duplicate session record scoped to `JM9QLXNJ75` rather than ever replacing or deduplicating an existing one. **We are stopping further `/initialize` attempts now** so we don't make this worse before you're able to look at it — please let us know once you've cleaned up the existing records, or confirm we should wait for an in-person device serial reissue instead.

## Follow-up to our previous ticket (TestSessionApiLog NullPointerException, resolved)

Thank you for fixing the `TestSessionApiLog`/`TestSessionApplicationStepDto` null-reference bug that was blocking `selectItemClass`, `saveItem`, `sendPurchaseTransactionInfo`, and `sendSalesTransaction` under PIN `P600004059A` (reported 2026-07-24/27/28, reappeared under that PIN on 2026-07-31). We confirmed the fix live on 2026-08-10 under a newly-issued Go-Live PIN (`P600004123A`) — all four endpoints now return real business validation instead of the crash.

**We've since hit a new, different server-side bug that is blocking Go-Live certification again**, this time even earlier in the flow — on `/initialize` itself.

## Account / environment

- Apigee App ID: `cff33b56-c663-48b9-80d1-d7d1ffae019c`
- Device serial (`dvcSrlNo`): `JM9QLXNJ75` — reused across this Go-Live session's PIN rotations
- Sandbox base URL: `https://sbx.kra.go.ke/etims-oscu/api/v1`
- Trader Invoicing System: Sync2Books compliance 2, v1.0, eTIMS Solution OSCU, Type of Integrator SELF
- Branch (bhfId): `00` (Headquarter)
- Integrator Pin: `P600004122A`

## Summary

Over the course of today's Go-Live testing session we worked under two different Application Test Pins issued for this app/device — `P600004123A`, then (after the developer portal's "Start Test" flow issued a new one) `P600004137A`. Both hit the identical error pattern:

> `responseCode 400`, `customerMessage: "Unable to process the request. Please try again"`, `debugMessage: "Unable to process the request. Please try again. Possible cause: Query did not return a unique result: 2 results were returned"`

This started appearing on read/write operations under `P600004123A` after we had called `/initialize` multiple times for `JM9QLXNJ75` during testing (each call succeeded and returned a `cmcKey`, but apparently created additional session records rather than reusing/replacing the prior one). It then got dramatically worse: **after generating a brand-new Application Test Pin (`P600004137A`) via the "Start Test" button on the Go-Live developer portal — a fresh test session that should have no prior history — `/initialize` itself fails with this same "2 results were returned" error**, reproducibly, on every retry.

This strongly suggests the ambiguity is keyed on **device serial `JM9QLXNJ75`**, not the Application Test Pin — i.e. session/device records are not being scoped or cleaned up per-PIN on your side, so a device that has been initialized multiple times (even under different, expired PINs) accumulates ambiguous state that breaks lookups requiring a single unique session match. This blocks Go-Live certification from even starting a fresh test run.

## Evidence

### `/initialize` failing with an ESCALATING result count on a fourth PIN (`P600004146A`)

Request:
```json
{"tin": "P600004146A", "bhfId": "00", "dvcSrlNo": "JM9QLXNJ75"}
```

Response — note it now says **3** results, not 2:
```json
{"responseHeader":{"responseCode":400,"responseRefID":"30927dc8-b7ea-44fe-baa5-f7c5e1ed70f7","customerMessage":"Unable to process the request. Please try again","debugMessage":"Unable to process the request. Please try again. Possible cause: Query did not return a unique result: 3 results were returned"},"responseBody":null}
```

This is the clearest evidence yet: the number of ambiguous records is incrementing with each attempt, which
is why we've stopped retrying further.

### `/initialize` failing on the PIN provided via your SMS reply (`P600004140A`)

Request:
```json
{"tin": "P600004140A", "bhfId": "00", "dvcSrlNo": "JM9QLXNJ75"}
```

Response:
```json
{"responseHeader":{"responseCode":400,"responseRefID":"5d44264a-cb94-4264-9bb7-c8167c16ec31","customerMessage":"Unable to process the request. Please try again","debugMessage":"Unable to process the request. Please try again. Possible cause: Query did not return a unique result: 2 results were returned"},"responseBody":null}
```

This is the exact same error as below, on the third distinct PIN we've tried against this device serial —
including one issued directly by your team specifically to resolve this.

### `/initialize` failing on a brand-new PIN (`P600004137A`, never used before this)

Request:
```json
{"tin": "P600004137A", "bhfId": "00", "dvcSrlNo": "JM9QLXNJ75"}
```

Response (two consecutive attempts, ~25 seconds apart):
```json
{"responseHeader":{"responseCode":400,"responseRefID":"1389b400-ae4b-42ef-b91a-12ab1cdff3bf","customerMessage":"Unable to process the request. Please try again","debugMessage":"Unable to process the request. Please try again. Possible cause: Query did not return a unique result: 2 results were returned"},"responseBody":null}
```
```json
{"responseHeader":{"responseCode":400,"responseRefID":"2eeaa422-46b7-4a5d-be5a-db7ecc8da6b7","customerMessage":"Unable to process the request. Please try again","debugMessage":"Unable to process the request. Please try again. Possible cause: Query did not return a unique result: 2 results were returned"},"responseBody":null}
```

### Same pattern, seen earlier today under the prior PIN (`P600004123A`)

`getPurchaseTransactionInfo`:
```json
{"responseRefID":"ba1b8cb0-ecea-4280-aae6-d73d77f4468a","debugMessage":"Unable to process the request. Please try again. Possible cause: Query did not return a unique result: 2 results were returned"}
```

`importedItemInfo`:
```json
{"responseRefID":"b0dba73b-773f-4b6f-ae67-ab0fb50fc2ce","debugMessage":"Unable to process the request. Please try again. Possible cause: Query did not return a unique result: 2 results were returned"}
```

`importedItemConvertedInfo`:
```json
{"responseRefID":"783d06f1-9d80-4954-a485-656ec7f61db8","debugMessage":"Unable to process the request. Please try again. Possible cause: Query did not return a unique result: 2 results were returned"}
```

`sendSalesTransaction` (blocking Invoice Generation evidence):
```json
{"responseRefID":"75653b6e-7950-4029-84bd-a7da5a5f9667","debugMessage":"Unable to process the request. Please try again. Possible cause: Query did not return a unique result: 2 results were returned"}
```

## Ruled out: client machine / network origin

We considered whether this is related to testing from a different client machine than the one originally
used to register `JM9QLXNJ75` (our earlier ticket's testing was done from a different physical machine
several weeks prior). We don't believe that's the cause: from the *current* machine, `/initialize` for
`JM9QLXNJ75` under PIN `P600004123A` succeeded earlier in this same session and returned a valid `cmcKey`
and `deviceId`, so this client can clearly authenticate and initialize successfully. The "2 results"
ambiguity only started appearing *after* several more `/initialize` calls were made against the same device
serial later in the same session — pointing at accumulated server-side session state rather than anything
client- or network-side. We're flagging the machine change anyway in case device/session state is tied to
some client-side signal (IP, user agent, etc.) in addition to `dvcSrlNo` on your end — worth ruling out on
your side too, but our own evidence points at repeated `/initialize` calls as the trigger.

## Why we believe this is server-side

- The error message itself (`Query did not return a unique result: 2 results were returned`) describes a backend query returning multiple rows where exactly one was expected — this is a data/session integrity issue on your side, not a malformed request (our request bodies for these calls were otherwise well-formed and, in most cases, byte-for-byte similar to earlier successful calls made minutes prior).
- It reproduces on a **freshly-issued PIN's very first `/initialize` call**, which should have no prior session history to conflict with — and it now reproduces identically across three separate PINs (`P600004123A`, `P600004137A`, `P600004140A`), all sharing only one thing in common: device serial `JM9QLXNJ75`.
- It's the second distinct "ambiguous/null test-session record" bug class we've hit this month (see prior ticket) — both point to test-session state not being scoped/cleaned up correctly per device or per PIN on your backend.

## Impact

We cannot currently start or complete a fresh Go-Live test run for device `JM9QLXNJ75` under any PIN, because `/initialize` itself fails. This blocks all four required Go-Live evidence screenshots (Item Creation, Invoice Generation, Invoice Copy, Credit Note) and the remaining test-case checklist.

## Ask

1. Please check whether device serial `JM9QLXNJ75` has accumulated multiple/ambiguous test-session records on your backend, and clean up or de-duplicate whatever `/initialize` is querying against — three different PINs against this same device serial have now all failed identically, so we don't believe issuing us a fourth PIN alone will resolve it.
2. If a server-side cleanup isn't feasible, please confirm whether device serial `JM9QLXNJ75` needs to be reissued, and what that process requires on our end (we understand this may require an in-person visit — if so, please let us know before we make the trip whether that will actually resolve this, versus the corruption being something a physical reissue wouldn't touch).
3. Happy to provide additional trace IDs, retry immediately once addressed, or hop on a call if that's faster — we're trying to complete Go-Live certification and have already validated the rest of our integration (auth, headers, item creation, sales, stock endpoints) works correctly against your fix from the previous ticket.
