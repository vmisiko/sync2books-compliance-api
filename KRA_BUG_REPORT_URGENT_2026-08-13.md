Subject: URGENT — device serial JM9QLXNJ75 blocks `/initialize` on every pin, escalating with each attempt, blocking a live timed Go-Live test window

## Impact

We are currently inside a live, timed Go-Live certification test window (1 hour to complete test cases) and
**cannot proceed at all** — `/initialize` fails for every Application Test Pin we try against device serial
`JM9QLXNJ75`, which blocks nearly every other test case downstream of it. This has now also started breaking
previously-working functionality on a pin that was never re-initialized (see below). We need this looked at
urgently, not on a standard ticket timeline.

## Account / environment

- Device serial (`dvcSrlNo`): `JM9QLXNJ75`
- Sandbox base URL: `https://sbx.kra.go.ke/etims-oscu/api/v1`
- Branch (bhfId): `00` (Headquarter)
- Trader Invoicing System: Sync2Books compliance, v1.0, eTIMS Solution OSCU, Type of Integrator SELF
- Apigee Apps involved: `cff33b56-c663-48b9-80d1-d7d1ffae019c` (1st, retired), `e0c07d61-386c-4628-8378-3a2874f14cc0` (2nd, retired), `0ada03d4-8b15-4c51-9a6b-7bdbe8ce2e78` (3rd, currently in use), `24f2cd5f-d697-4995-96cd-858de93ff0a0` (4th, just created today, 0 tests run)

## Core symptom

`/initialize` fails with:

> `responseCode 400`, `debugMessage: "Unable to process the request. Please try again. Possible cause:
> Query did not return a unique result: N results were returned"`

**`N` increases by exactly one with every single `/initialize` call against this device serial** —
regardless of which Application Test Pin or which Apigee App is used. This has now been confirmed across
**8 distinct Application Test Pins and 4 distinct Apigee Apps** over 3 days (2026-08-11 through
2026-08-13). Registering a new Apigee App does not fix it — it briefly appeared to on 2026-08-12 because a
fresh app's *first* `/initialize` call happened to succeed, but its second call failed identically, and this
pattern has now repeated on every subsequent app.

## Today's timeline (2026-08-13), most urgent evidence

1. New Application Test Pin `P600004156A` (Apigee App `0ada03d4-...`) → `/initialize` failed:
   `"Query did not return a unique result: 2 results were returned"`.
2. New Application Test Pin `P600004165A` under a **brand-new Apigee App** `24f2cd5f-d697-4995-96cd-858de93ff0a0`
   (KRA dashboard confirmed 0 tests ever run under this app) → `/initialize` failed with a **different**
   error: `resultCd: "901"`, `"It is not valid device"`. This suggests device serial `JM9QLXNJ75` was never
   associated with this new app on your side — if device/app association requires a manual step on your end,
   please confirm what that is.
3. Same pin `P600004165A`, reverted back to the original Apigee App `0ada03d4-...` (a "new session" was
   triggered for this app on your developer dashboard) → `/initialize` failed again:
   `"3 results were returned"`.
4. Retried once more (same pin/app) → escalated to `"4 results were returned"`.
5. **To rule out any possibility this is caused by our own application code**, we made a raw, minimal `curl`
   request directly to your sandbox — no application logic, no custom headers beyond the required
   `tin`/`bhfId`/`apigee_app_id`/bearer token, nothing but the bare HTTP call:

   ```
   POST https://sbx.kra.go.ke/etims-oscu/api/v1/initialize
   Headers: tin: P600004165A, bhfId: 00, apigee_app_id: 0ada03d4-8b15-4c51-9a6b-7bdbe8ce2e78,
            Authorization: Bearer <fresh token from /v1/token/generate>
   Body: {"tin":"P600004165A","bhfId":"00","dvcSrlNo":"JM9QLXNJ75"}
   ```

   Response (responseRefID `fbb7b055-d08e-4cdd-85e5-74655fed4fbd`):
   ```json
   {
     "responseHeader": {
       "responseCode": 400,
       "responseRefID": "fbb7b055-d08e-4cdd-85e5-74655fed4fbd",
       "customerMessage": "Unable to process the request. Please try again",
       "debugMessage": "Unable to process the request. Please try again. Possible cause: Query did not return a unique result: 4 results were returned"
     },
     "responseBody": null
   }
   ```
   Identical error, same count as our application's own attempt moments earlier — this is conclusive proof
   the issue is entirely server-side, not anything in our client. (Note: the count did *not* increment
   further on this repeat call, staying at 4 — so it is not incrementing on literally every single request,
   which may be a useful clue for your own investigation.)

## Separate, worse finding: the corruption has spread beyond `/initialize`

A pin that was previously fully working (`P600004152A`, verified live end-to-end on 2026-08-12 — item
registration, stock in/out, stock master, sales transactions with real receipts, credit notes, all
succeeding with `resultCd: "000"`) **has now started failing `saveItem` (new item registration)** with the
identical `"Query did not return a unique result"` error — **without that pin ever being re-initialized**.
This confirms the ambiguous records are keyed on the device serial itself, not the pin, and are now affecting
functionality that was working correctly before today's `/initialize` attempts on other pins.

Everything else on `P600004152A` (stock movements, sales, credit notes, lookups, branch writes) still works
correctly for *already-registered* items — only new item registration and `/initialize` are currently
broken.

## Why we believe this is server-side

- The error message itself describes a backend query returning multiple rows where one was expected — a
  data/session integrity issue on your side.
- It is completely consistent regardless of pin or Apigee App, and gets strictly worse with each attempt,
  never better.
- It has now demonstrably spread to affect a previously-working pin's unrelated functionality
  (`saveItem`), which cannot be explained by anything on our end — we did not modify or re-initialize that
  pin.

## Ask (urgent)

1. Please check server-side session/device records for `dvcSrlNo = JM9QLXNJ75` and clean up whatever is
   causing the ambiguous match — ideally today, given our live test window.
2. If a device serial reissue is the only fix, please advise the fastest path to get one, and confirm
   whether reissue actually resolves this class of corruption (a prior support thread on this same issue is
   attached/referenced below — we want to avoid a reissue that doesn't address the root cause).
3. Please confirm whether associating a new Apigee App with an existing device serial requires a manual step
   on your side (see point 2 in today's timeline, `resultCd: 901 "It is not valid device"`).
4. Happy to hop on a call immediately if that's faster than async replies.

## Related prior ticket

See `KRA_SUPPORT_TICKET_DRAFT_2.md` for the full evidence trail from 2026-08-11/12 on this same device
serial (earlier belief that a new Apigee App resolved this was wrong — retracted, see that file's later
updates).
