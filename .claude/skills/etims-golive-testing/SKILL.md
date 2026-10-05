---
name: etims-golive-testing
description: Drives the KRA eTIMS OSCU Go-Live certification testing workflow for Sync2Books end-to-end — standing up the compliance-api stack locally (compliance-api only — no main-API eTIMS routes; items/stock/sales go through its /v1 developer API with a dashboard-issued key), provisioning new Go-Live credentials (Apigee App ID, Application Test Pin, device serial), and working through the 23-test-case checklist on developer.go.ke. Use this whenever the user wants to test the eTIMS/OSCU Go-Live checklist, drive the KRA sandbox tests, provision a new Application Test Pin for Sync2Books, or debug a failing OSCU endpoint (saveItem, insertStockIO, sendSalesTransaction, credit notes, etc.) — even if they just paste new credentials and say "try again" or share a screenshot of the developer.go.ke test dashboard. Also use it for the go-live RESUBMISSION after KRA's rejection on the TIS page 8/10 invoice and credit-note template — building the realistic item/customer/invoice/credit-note dataset (mirroring the QuickBooks catalogue), generating the receipt PDFs, and checking them against the template. Encodes a full session's worth of hard-won debugging (payload shapes, sequencing bugs, environment gotchas) so it doesn't get rediscovered from scratch.
---

# eTIMS Go-Live Testing (Sync2Books)

This project integrates Sync2Books with Kenya's eTIMS tax system via KRA's OSCU sandbox. Getting through
KRA's 23-test-case Go-Live checklist (tracked at `developer.go.ke/myapps/testcases/...`) requires driving
real HTTP calls through `sync2books-compliance-api` → KRA's sandbox (the main API is no longer involved). The sandbox is flaky and its request formats diverge from its own documentation in specific,
previously-discovered ways — this skill exists so those aren't rediscovered by trial and error every time.

**Read `references/oscu-payload-gotchas.md` before making direct OSCU calls (saveItem, insertStockIO,
saveStockMaster, sendSalesTransaction, credit notes)** — it has the exact request shapes that work and why
the "obvious" version of each fails.

## Current status (2026-10-05): third attempt, all 23 rows green — and the flow is compliance-api only

History: attempt 1 passed all 23 rows but KRA rejected the **receipt template** (TIS pages 8/10); attempt 2
(2026-09-17, new THIRDPARTY app) and a Gear Train app (2026-09-18) followed; attempt 3 (2026-10-05, App ID
`77ab8b13-…`, pin `P600004862A`) went green on all 23 rows through the **developer API**. Per-run values live in
the memory notes; this skill holds the procedure.

**The main API (`nest-sync-2-books-api`) is not part of the go-live flow any more.** Its public eTIMS routes
were removed 2026-09-21. Everything below uses `sync2books-compliance-api` only: its internal routes
(service token) for provisioning and the checklist-only OSCU calls, and the public `/v1` developer API (a
dashboard-issued API key) for items, stock, sales and credit notes. The main API only has to be *running*,
because the dashboard creates a companion company id on first open (see Step 3) — no eTIMS call goes through it.

Before creating any item, customer, sale or credit note, read **`references/golive-resubmission-dataset.md`**
(naming rule — nothing may read as fabricated; the 13-item catalogue, customers and 8 documents; the TIS
page 8/10 acceptance checklist). Background on the original rejection: `.docs/TIS_TEMPLATE_CONFORMANCE_PLAN.md`.
Spec copy: `.docs/TIS-for-OSCU--VSCU-Technical-Specifications-v2.0.pdf`.

**Lessons from 2026-10-05 that cost real time — read before starting:**
1. **Receipt text is snapshotted at issue time.** Trade name, address, header and footer are sent to KRA with
   each sale and the PDF replays that snapshot. Settings saved afterwards never reach issued receipts, and KRA
   records can't be edited — so set **Receipt settings in the dashboard first**, then issue the evidence set.
   (We issued 8 documents, saved settings 6 minutes later, and had to re-issue all 8.)
2. **Opening a business in the dashboard can overwrite its initialized connection** with the
   `ETIMS_SANDBOX_SHARED_*` values from `.env` (old pin/device/cmcKey) — every KRA call afterwards goes out under
   the wrong pin. Fixed in compliance-api PR #27 (`fix/preserve-initialized-etims-connection`); until that is
   merged, point the four `ETIMS_SANDBOX_SHARED_*` vars at the NEW device *before* opening the business, and
   re-check `compliance_etims_connections` (pin/deviceId) afterwards.
3. **Never run `/catalog/items/resync-item-cd-sequence` to "fix" an `Expected sequence ending with N` error.**
   That error with N far above your item count means the connection is on the wrong pin (see 2); the resync
   then lowers the *other* pin's counter and marks your items REGISTERED with someone else's `itemCd`s.
4. **Save the full `/initialize` response the moment you get it** (it holds the only copy of `cmcKey`).
5. **KRA seeds imported items and supplier invoices lazily** — only after the pin has real activity. Rows 12, 13,
   15, 16 return `001` right after init and real data ~20 minutes / a dozen sales later. Row 12 *fails* the
   dashboard on `001` even though `001` passes rows 15/18/21/22 — re-query before debugging.

## The services

- `sync2books-compliance-api` (NestJS, :3001) — talks to KRA's sandbox
  (`https://sbx.kra.go.ke/etims-oscu/api/v1`, integrator path style) and exposes everything this skill needs.
  Two ways in: **internal routes** (`/compliance-organization/*`, `/oscu/*`, `/catalog/*`, `/api/*`; headers
  `Authorization: Bearer $COMPLIANCE_SERVICE_TOKEN` + `x-sync2books-company-id: <merchantId>`) and the public
  **`/v1/*` developer API** (`Authorization: Bearer cmp_sk_test_…`, business-scoped, see Step 4).
- `Next-Sync-2-books-compliance-dashboard-ui` (:3002) — where you sign in, set Receipt settings and create the
  API key (Integrations). Also the quickest way to eyeball items/sales.
- `nest-sync-2-books-api` (:3000) — **not used for eTIMS.** Must be running only so the dashboard can create the
  companion company id.
- Start/stop the stack with `s2b up | status | restart compliance | logs compliance` (installed at
  `~/.local/bin/s2b`; logs in `<workspace>/.s2b/logs/`).

Drive the flow through `/v1` where it has a route; fall back to the internal routes for the checklist-only
OSCU calls, or raw `curl` against KRA's sandbox when isolating whether a bug is ours or KRA's.

**⚠️ NOT RESOLVED — `JM9QLXNJ75` "Query did not return a unique result" is a real, ongoing, escalating
KRA-side corruption tied to the device serial itself. Every theory below claiming this was "fixed" (new
Apigee app, new pin) was superseded by later evidence. Read this whole entry before touching `/initialize`.**

**Confirmed root behavior (2026-08-13, most rigorous evidence yet, gathered after eliminating every other
possible cause):**
- `/initialize` fails with `"N results were returned"` where `N` **increments by one on every single
  `/initialize` call against this device serial** — confirmed across 2026-08-11 and 2026-08-12/13,
  regardless of which Application Test Pin or Apigee app is used. A pin's *first* `/initialize` call under a
  fresh app pairing can succeed (this is what created the false "switching apps fixed it" belief on
  2026-08-12) — but that's luck of the count, not a fix. The 2nd, 3rd, etc. calls under the same device
  serial reliably fail.
- **This has now spread beyond `/initialize` itself**: on 2026-08-13, `saveItem` (new item registration)
  started failing with the identical error, on the *previously fully-working* pin `P600004152A`, without
  that pin ever being re-initialized. Confirmed in a fully clean, single-process, freshly-verified
  environment (see the process-management gotcha below — this was re-verified specifically to rule out
  stale-process artifacts as the cause, and the error persisted identically).
- **Not everything is affected.** `branchList`, `insertStockIO`, `saveStockMaster`, and presumably other
  operations that don't need whatever internal device-record lookup `saveItem`/`/initialize` share, continue
  to work fine on `P600004152A` for *already-registered* items. **Practical workaround: don't register new
  items right now — everything else (stock movements, sales, credit notes, lookups, branch writes, purchase
  transactions) still works using items registered earlier.**
- **Do not call `/initialize` again on this device serial without explicit user confirmation** — it only
  makes the count worse, never better. If a future session needs a working connection, use the currently
  active one (check `compliance_etims_connections` for `dvcSrlNo='JM9QLXNJ75'` — as of 2026-08-13 that's
  `P600004152A`) rather than provisioning a new pin.
- This is a genuine KRA sandbox bug requiring their intervention (device serial reissue or server-side
  session cleanup) — see `KRA_SUPPORT_TICKET_DRAFT_2.md` for the evidence trail. Don't re-debug this locally
  again; there is nothing left to find client-side.

**⚠️ Process management gotcha (2026-08-12): `pkill -f "node_modules/.bin/nest start"` does NOT kill a
running compliance-api/nest-api server.** `nest start` (non-watch mode, i.e. `pnpm start`) execs into
`node dist/main` — the process's command line changes, so a pattern match on the original `nest start`
invocation stops matching it after the exec. A "restart" that pkills by that pattern and then relaunches
silently fails: the new process crashes with `EADDRINUSE` (port already held by the old one), while curl
health checks against `/docs` or `/health` keep returning 200 because the **old** process, with its old env
vars (old Apigee app id, old client id/secret, etc.), was never actually killed and is still the one serving
traffic. This produced a false "still corrupted with a new Apigee app" result earlier in this project — the
user had to catch it by asking "are you sure you used the new .env?". To restart correctly: find the actual
listening PID with `lsof -ti :3001 -sTCP:LISTEN` (or `:3000` for nest-api), `kill -TERM` that exact PID,
confirm `lsof` shows nothing on the port, then relaunch. After relaunching, verify the new env actually took
effect *before trusting any test result against it*:
`ps eww -p $(lsof -ti :3001 -sTCP:LISTEN) | tr ' ' '\n' | grep ETIMS_OSCU_APIGEE` and check it matches the
current `.env`. The new centralized `postOscu()` logging (see below) also helps catch this class of mistake
going forward — check the `merchant=... branch=... env=...` line actually reflects what you expect before
trusting a result.

**⚠️⚠️ Much worse version of the same class of bug (2026-08-13): a background `pnpm start:dev` (watch mode)
process can be silently running from an earlier session/tool call and nobody remembers starting it.** Unlike
`pnpm start`, watch mode auto-rebuilds and **respawns a brand-new `dist/main` child on every source file
save** — so simply editing a `.ts` file while investigating a bug creates yet another overlapping process,
each with whatever env it inherited at its own start time. Over one session this produced **6+ simultaneous
node processes** for these two apps, several going back hours, competing for the same ports. This makes
every "verify the PID's env" check from the gotcha above unreliable *unless you also check for and kill any
watch-mode process first* — `ps aux | grep -iE "start:dev|nest.js start --watch"`, kill every match (the
shell wrapper AND its child), confirm nothing remains, **then** restart cleanly with plain `nest start`
(no watch) and re-verify. If you see a `dist/main` process with a start time you can't account for, or curl
health checks keep succeeding right after a kill you thought was clean, suspect this first.

## Step 1 — Get credentials from the user

Ask for whatever you don't already have, from the KRA Go-Live page (`developer.go.ke`) or the credentials
card at the top of the test-case dashboard:

- Apigee App ID
- Application Test Pin (this is the `kraPin` used everywhere below)
- Integrator Pin
- Device Serial Number
- Branch Id (almost always `00`)
- Apigee OAuth consumer key + secret — **new for every new Apigee app** (a new app = new App ID + new key/secret);
  they only stay constant across Application Test Pin rotations *within* one app, so ask if unsure

**If the user says they've generated a new Application Test Pin without saying anything else changed**,
assume device serial / Apigee App ID / consumer key+secret are unchanged and only ask for what's different.

## Step 2 — Stand up the environment

```bash
s2b up            # infra containers + api, compliance, dashboard, console
s2b status        # ports/PIDs/HTTP status; compliance :3001, dashboard :3002
```

If a container is stopped, `docker start <name>` brings it back with data intact; if Docker is down,
`open -a Docker` and wait for `docker info`. `s2b` runs services in watch mode (`start:dev`) — which is exactly
the stale-process trap described near the top of this skill, so after any `.env` change use
`s2b restart compliance` (never `pkill`) and don't start a second copy by hand (it dies with `EADDRINUSE`
while the old one keeps answering `/docs`).

### compliance-api `.env`

`ConfigModule` loads `sync2books-compliance-api/.env` (gitignored). For a new app, comment out the previous
app's trio and add the new one — keep the old lines commented as history:

```
ETIMS_ADAPTER_MODE=http
ETIMS_OSCU_PATH_STYLE=integrator
ETIMS_OSCU_SANDBOX_BASE_URL=https://sbx.kra.go.ke/etims-oscu/api/v1
ETIMS_OSCU_APIGEE_CLIENT_ID=<consumer key>
ETIMS_OSCU_APIGEE_CLIENT_SECRET=<consumer secret>
ETIMS_OSCU_APIGEE_APP_ID=<Apigee App ID>
ETIMS_STOCK_SYNC=true
ETIMS_STOCK_MASTER_SYNC=true
COMPLIANCE_SERVICE_TOKEN=<any non-empty string locally>
```

Back up `.env` first (outside the repo), then `s2b restart compliance`. Confirm the key/secret are what the
process uses: a token call with them against `https://sbx.kra.go.ke/v1/token/generate?grant_type=client_credentials`
(HTTP Basic) returns an `access_token`. If KRA's host does not resolve from this Mac (`Could not resolve host`
while google.com works) flush the DNS cache — `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder` —
before concluding anything; `/initialize` failing with `retryable: fetch failed` was exactly this.

**compliance-api's stock inventory lives in MySQL now** (`inventory_stock`, `stock_movements`) — it survives
restarts. (Older notes saying it is in-memory are out of date.)

## Step 3 — Provision the business (no main API)

Internal routes need `Authorization: Bearer $COMPLIANCE_SERVICE_TOKEN` and an `x-sync2books-company-id` header;
for tenant creation any UUID works for the header (it is only an assertion check).

```bash
H=(-H "Authorization: Bearer $TOKEN" -H "x-sync2books-company-id: $(uuidgen | tr A-Z a-z)" -H "Content-Type: application/json")
# 1. tenant + default branch (kraBhfId 00) + eTIMS shell
curl -s -X POST localhost:3001/compliance-organization/tenants "${H[@]}" -d '{"kraPin":"<Application Test Pin>","environment":"SANDBOX"}'
#    -> note tenant.id and defaultBranchId
# 2. attach the device serial
curl -s -X PUT localhost:3001/compliance-organization/branches/$BRANCH/etims-connection "${H[@]}" \
  -d '{"kraPin":"<Application Test Pin>","dvcSrlNo":"<device serial>","environment":"SANDBOX"}'
# 3. initialize — ONCE per device+pin. Save the whole response to a private file: it holds the only copy of cmcKey.
curl -s -m 120 -X POST localhost:3001/compliance-organization/branches/$BRANCH/etims-connection/initialize "${H[@]}" > init.json
```

`/initialize` persists `deviceId`, `sdcId` (printed as "CU ID" on every receipt), `mrcNo` and `cmcKey`. Do **not**
use the dashboard's "Add Business" for the go-live pin: it copies `ETIMS_SANDBOX_SHARED_*` from `.env` instead of
initializing, which silently attaches whatever device those vars name. If `/initialize` answers
`902 This device is installed`, it already ran for this pin — recover the values rather than re-calling it
(see the device-corruption section). If the response is empty or the process died mid-call, check
`compliance_etims_connections` before retrying.

4. **Make the shared-sandbox vars point at the new device** (until PR #27 is merged): set
   `ETIMS_SANDBOX_SHARED_KRA_PIN / _DVC_SRL_NO / _DEVICE_ID / _CMC_KEY` to the new pin, serial, `deviceId` and
   `cmcKey` from `init.json`, then `s2b restart compliance`.
5. **Attach the tenant to a dashboard organisation** (no API for this — a DB write):
   `UPDATE compliance_tenants SET organizationId='<org id>', displayName='<name>' WHERE id='<tenant id>'`.
   Use the name **KRA holds for the pin** as `displayName` — it prints as the business name on every receipt
   (`selectTaxpayerInfo` returns it as `taxprNm`; for sandbox test pins it is `SYNC TO BOOKS RECONCILER LIMITED`,
   whatever "Trader Invoicing System Name" the developer.go.ke card shows). Find the org via the dashboard user:
   `select organizationId from dashboard_users where email='…'`.
6. **Sign in to the dashboard (localhost:3002), open the business, and set Receipt settings** (address, header,
   footer, optional trade name — 20 chars max, printed and sent exactly as typed — and logo) **before issuing
   anything** (lesson 1). Opening the business triggers `ensureCompany`, which creates a main-API company and
   stamps its id on the tenant as `sync2booksCompanyId` — this id is your **merchantId** for the internal routes
   (`select sync2booksCompanyId from compliance_tenants where id=…`). Then re-check the connection row still has
   the new pin/deviceId (lesson 2).
7. **Create the API key:** business → *Integrations* → *Create API key* → Test, all permissions. The key is
   shown once in the dialog; keep it in a private file, never in the repo or chat. Check it:
   `curl localhost:3001/v1/me -H "Authorization: Bearer $KEY"` should return `scope: business` and your tenant id.

**Internal routes use `merchantId=<sync2booksCompanyId>` and `branchId=<branch UUID>`, not `00`**: a branch created
this way has `sync2booksBranchId = NULL`, and `00` answers `No active eTIMS connection`. `/v1` needs neither
(the key binds the business; the branch defaults to its only one).

## Step 4 — Reference data, items, stock, sales, credit notes

Order matters; each step unlocks the next.

**4a. Reference data first, under the right pin** (checklist rows 2 and 3 — and KRA refuses `saveItem` and
`insertStockIO` until the device has fetched the classification list: *"Make 'Get Item Classification List'
request before performing StockIo"*):
```bash
curl -s -X POST localhost:3001/catalog/codes/sync "${H[@]}" -d '{"merchantId":"<merchantId>","branchId":"<branch uuid>","full":true}'
curl -s -X POST localhost:3001/catalog/item-classifications/sync "${H[@]}" -d '{"merchantId":"<merchantId>","branchId":"<branch uuid>","full":true}'
```
(with `x-sync2books-company-id` set to the merchantId). Expect 755 codes / 26 classifications in the sandbox.

**4b. Items** — take every name, unit and price from `references/golive-resubmission-dataset.md` §3.
```bash
curl -s -X POST localhost:3001/v1/items -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"externalId":"53","name":"Grilled Goat Ribs (per kg)","taxCategory":"VAT_STANDARD","productTypeCode":"2",
       "classificationCode":"1010150800","unitCode":"KG","packagingUnitCode":"NT","unitPrice":1392}'
curl -s -X POST localhost:3001/v1/items/<id>/register -H "Authorization: Bearer $KEY" -d '{}'
```
`productTypeCode`: `2` goods, `3` service. The item id is `item-<merchantId>-API-<externalId>`. Registration
failures come back as HTTP 422 `registration_failed` with KRA's message. Item codes should come out sequential
from `…0000001` — if KRA says `Expected sequence ending with ********N` with a big N, stop and check the
connection row's pin (lesson 3).

**4c. Opening stock for goods only** (services are exempt, TIS §6.29), always with `unitPrice` (tax-inclusive):
```bash
curl -s -X POST localhost:3001/v1/stock/adjustments -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"itemId":"<id>","action":"ADD","quantity":60,"unitPrice":1392,"referenceId":"OPENING-STOCK"}'
```
Read `data.etims.stockIo.status` / `stockMaster.status` — both must be `ok`. The local quantity is saved even
when the KRA push fails, so on a failed push fix the cause, then `DELETE` that item's rows from `stock_movements`
and `inventory_stock` before re-adding, or the local quantity doubles.

**4d. Sales** — `unitPrice` is tax-inclusive; the tax band comes from the item, never the caller. Always send an
`Idempotency-Key` (use the invoice number) and a `customer.name`:
```bash
curl -s -X POST localhost:3001/v1/sales -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: INV-261005-10" -d '{"traderInvoiceNumber":"INV-261005-10","saleDate":"2026-10-05",
  "paymentTypeCode":"04","customer":{"name":"Amani Business Park Ltd","pin":"P052581715V","phone":"+254733221100",
  "email":"accounts@amanibusinesspark.co.ke"},"lines":[{"itemId":"<id>","quantity":8,"unitPrice":1392}]}'
```
Issue them in dataset order. `status: completed` means KRA answered — confirm `ACCEPTED` in the DB (below).

**4e. Credit notes.** `POST /v1/credit-notes` reverses a sale **in full, once**. The evidence needs a *partial*
credit note against the mixed invoice, which only the internal route does (service-token headers, `merchantId`
and the branch UUID in the body):
```bash
curl -s -X POST localhost:3001/api/sales "${H[@]}" -d '{"merchantId":"<merchantId>","branchId":"<branch uuid>",
 "saleDate":"2026-10-05","traderInvoiceNumber":"CN-261005-02","originalTraderInvoiceNumber":"INV-261005-10",
 "creditNoteDate":"2026-10-05","creditNoteReasonCode":"06","customerTin":"P052581715V",
 "customerName":"Amani Business Park Ltd","receiptTypeCode":"R","paymentTypeCode":"04","invoiceStatusCode":"02",
 "items":[{"id":"<item id>","quantity":2,"unitPrice":1392,"taxCategory":"VAT_STANDARD","taxAmount":384},
          {"id":"<item id>","quantity":1,"unitPrice":500,"taxCategory":"OTHER","taxAmount":0}]}'
```
Positive quantities (the renderer negates); `taxAmount` = line total − total/1.16 for band B, else 0. The
original must be `ACCEPTED` first. Stored `totalAmount` for a credit note is tax-on-top (3,668 for a 3,284
receipt) — the PDF and KRA carry the correct figure; don't read receipt totals from the DB.

**4f. Receipt PDFs:** `GET /api/sales/<url-encoded document id>/receipt` with the service-token headers (or
`/v1/sales/:id/receipt` with the key). Check each against the §5 acceptance checklist in the dataset reference
*and* that the business name, address, header and footer actually appear (lesson 1). Evidence goes in
`.docs/go-live-evidence/<run>/`; move superseded PDFs into a clearly named subfolder.

**Verifying outcomes and reading failures.**

Check outcomes in the compliance-api DB, not just the HTTP response (the pipeline can finish after the HTTP response):

```bash
docker exec sync2books-compliance-mysql mysql -uroot -ppassword compliance -e "
SELECT id, complianceStatus, submissionAttempts, etimsReceiptNumber FROM compliance_documents
WHERE documentNumber='<traderInvoiceNumber>'\G"
docker exec sync2books-compliance-mysql mysql -uroot -ppassword compliance -e "
SELECT eventType, responseSnapshot FROM compliance_events
WHERE documentId LIKE '%<traderInvoiceNumber>%' ORDER BY createdAt DESC LIMIT 1\G"
```

The `WARN` line in `compliance-api.log` (e.g. `eTIMS insertStockIO rejected: HTTP 400 calling OSCU: <detail>`)
now includes KRA's actual `debugMessage`/`customerMessage` when the rejection is HTTP-level (not just a
KRA-envelope `resultCd`/`resultMsg`) -- fixed 2026-08-11 in `etims-adapter.http.ts`'s `describeHttpRejection()`
after repeatedly having to re-derive it by hand from `responseSnapshot`/`oscu_operation_logs`. If you still
need the full raw payload, it's there too.

**Logging is now centralized in `postOscu()` (2026-08-12) — don't hand-add `console.error` again.** Every
single OSCU call, both the generic envelope dispatch and the bespoke typed methods (`insertStockIO`,
`saveStockMaster`, `saveItem`, `selectStockMoveList`, `submitInvoice`), funnels through one private method
in `etims-adapter.http.ts`. That method now:
- logs every outgoing request at `debug` (`-> insertStockIO merchant=... branch=... env=... body={...}`) —
  set `NODE_ENV`/log level to see full request payloads without adding anything.
- logs every rejected response (`!res.ok` OR `resultCd !== '000'`) at `warn` with the **full raw KRA
  response body**, not just a derived string.
- logs thrown exceptions (network failures) at `error`, **including `error.cause`** — this is exactly what
  disambiguated the local `ENETDOWN`/"fetch failed" sandbox flakiness from a real KRA-side rejection during
  this project's `insertStockIO` debugging, and previously required temporarily adding `console.error` to
  inspect `.cause` and then reverting it. Don't re-add that by hand; it's already logged every time.

`InventoryService`'s own `insertStockIO`/`saveStockMaster` warn logs (in `inventory.service.ts`) were also
enriched to include `itemCd`/`sarNo`/`movement id` (or `branch`/`rsdQty` for stock master), so you can
correlate a domain-level failure with the adapter-level request/response log lines above by timestamp.

## Step 5 — Work through the rest of the checklist

**Use `references/golive-test-case-runbook.md`** — every one of the 23 dashboard rows mapped to the exact
route, in dependency order, with the write payloads that passed live on 2026-09-17. The notes below are the
background for it.

Most of the remaining 23 test cases map onto `sync2books-compliance-api`'s existing OSCU pass-through
routes (`GET/POST /oscu/*`, see `src/regulatory/oscu/presentation/oscu-operations.controller.ts`) — call
these directly with `merchantId` (the sync2books company id) and `branchId` (the sync2books branch id, e.g.
`00`). A `resultCd: "001"` ("no search result") on a lookup is *usually* a valid pass (it passed rows 15, 18, 21, 22) —
but **not always**: row 12 (imported item list) showed Failed on `001`, and rows 12/15/16 only return data after the
pin has had real activity (KRA seeds them lazily — see lesson 5). If a dependent write (row 13, row 16) needs data
that is not there yet, do the sales first and re-query. The compliance-api HTTP wrapper surfaces both as an error though, so check
`oscu_operation_logs` for the real `resultCd` rather than trusting the HTTP status code.

`selectCustomerList` (`GET /oscu/customers?merchantId=...&branchId=...`) was missing entirely until
2026-08-11 — every other lookup in the dashboard checklist had a route, this one didn't. Added following the
exact same generic-envelope pattern as `branchList`/`selectNoticeList`/`customerPinInfo` (no special-casing
needed, unlike `selectStockMoveList`); confirmed live with `resultCd: "000"` and a real `custList` entry. If
a *different* Go-Live test case 404s the same way, it's very likely the same gap: check
`oscu-operations.controller.ts` for a matching route before assuming it's a payload bug, and wire it the same
way if it's missing (port interface → http adapter one-liner via `postOscuEnvelope` → stub adapter → service
dispatch entry → controller route).

## The developer.go.ke test-case dashboard

This is KRA's own live tracker, separate from anything we control — reach it with **Claude in Chrome
tools** (`mcp__claude-in-chrome__*`), not the sandboxed Browser pane, since it needs the user's real
authenticated session.

- URL pattern: `developer.go.ke/myapps/testcases/{apigeeAppId}/{sessionId}`.
- **Always re-read the "Application Test Pin" shown live on that page before testing** — it can differ
  from what you were last told, and calls made under a stale/expired pin won't register.
- The "you must complete within one hour" warning is only about running the tests; the visible countdown
  ("Remaining Test Time") covers the full ~3-hour window including evidence upload. If it's showing single
  digits, don't panic — check whether a new session needs to be started rather than assuming everything's
  lost.
- Pass/fail appears cumulative on the Apigee App across pin rotations for at least some test cases, so
  earlier work isn't necessarily wasted when the pin changes.
- New sessions are started at `developer.go.ke/golive/start-test/schedule/{apigeeAppId}` — a form
  pre-filled with existing values, submitted via a "START TEST" button.
- The 4 required Go-Live evidence screenshots: **Item Creation, Invoice Generation, Invoice Copy, Credit
  Note**. Prioritize getting these 4 working before circling back to the rest of the 23-item checklist —
  they're what actually gets submitted with the Go-Live application. **The first submission was rejected on
  the Invoice Copy / Credit Note artifacts** — use the mixed goods+service invoice (document #3) and its
  partial credit note (#8) from `references/golive-resubmission-dataset.md`, and tick the §5 page 8/10
  checklist on both PDFs before uploading.

### The dashboard's pass/fail badges lag behind reality — don't trust them as ground truth

Confirmed 2026-08-11: after fixing every bug blocking `sendSalesTransaction` and getting a real `ACCEPTED`
response with a live receipt signature and `etimsUrl` directly from KRA, the dashboard's "SAVE SALES
TRANSACTION" row still showed **Failed**, displaying a *stale* error (`"Invc No: 5 is invalid..."`) from
an earlier, already-fixed attempt. The dashboard does not appear to reliably re-poll or refresh a test
case's status just because a later call to that endpoint succeeded.

**The reliable source of truth is always the raw KRA response from your own calls** (`resultCd: "000"`, a
real receipt number, a real `etimsUrl`/`receiptSignature`) — not the dashboard's colored badges. If the
user reports a badge still shows Failed after you've confirmed success directly:
- Don't assume your fix didn't work — check your own evidence first (query `oscu_operation_logs` /
  `compliance_events`, or make one more direct call and read the raw response).
- Don't re-trigger `/initialize` or "Start Test" just to force a badge refresh — that risks re-triggering
  the device/session corruption bug below for no benefit; the badge is cosmetic, not the actual state.
- If there's a per-row re-run control on the dashboard, ask the user to point it out rather than guessing
  at one — we did not find one during this session's testing.

## The device/session corruption bug (KRA-side) — and its actual fix

Calling `/initialize` more than once for the same device serial — even across different, expired
Application Test Pins, all under the *same Apigee app* — accumulates ambiguous session records on KRA's
backend. Eventually this breaks endpoints (including, in one observed case, a brand-new pin's very first
`/initialize` call) with:

> `"Unable to process the request... Possible cause: Query did not return a unique result: 2 results were returned"`

...and the "results were returned" count goes *up* by one on every further `/initialize` attempt (2 → 3 →
...) — direct proof that retrying adds another duplicate record rather than resolving anything. **We also
found strong evidence that the same underlying corruption manifests as sales silently failing with
`"Items provided under the itemList section do not exist in your stock"` even when stock is genuinely
registered correctly** — it's not just an `/initialize`-specific symptom.

Not caused by switching client machines — confirmed by direct evidence: `/initialize` succeeded from a
given machine earlier in a session, then started failing later in that *same* session after several more
`/initialize` calls against the same device serial. Not fixed by a new Application Test Pin alone either —
we tried three different pins (issued three different ways, including one KRA support sent via SMS
specifically to fix this) against the same Apigee app, and all three failed identically.

### The fix that actually worked: register a new Apigee app

**Creating a brand-new Apigee app on the developer portal (My Apps → new app), for the *same* device serial
and a pin already associated with it, immediately resolved both the `/initialize` ambiguity and the phantom
"stock doesn't exist" sales failure — with zero other changes.** This is self-service (no KRA office visit,
no waiting on a support ticket) and is now the **first thing to try**, not a last resort, when you hit this
error class:

1. Confirm it's really this bug (not a payload issue) — retry the exact same call once with no changes; if
   the error is identical, or the sales failure persists despite confirmed-correct stock registration, it's
   this.
2. Have the user create a new app on `developer.go.ke` (My Apps → create a new app for the same product/API).
   This issues a new Apigee App ID and a new consumer key/secret pair — get these from the user (see Step 1
   in this skill).
3. Reconfigure `.env` with the new `ETIMS_OSCU_APIGEE_APP_ID` / `ETIMS_OSCU_APIGEE_CLIENT_ID` /
   `ETIMS_OSCU_APIGEE_CLIENT_SECRET`, restart compliance-api, and re-provision the connection (Step 3) — the
   device serial and Application Test Pin can stay the same.
4. Call `/initialize` once for the new app. It should succeed cleanly. If the same error still appears even
   under a fresh app, *then* it's time to escalate to KRA support (template pattern in
   `sync2books-compliance-api/KRA_SUPPORT_TICKET_DRAFT.md` and `KRA_SUPPORT_TICKET_DRAFT_2.md`) or have the
   user get a new device serial in person — but try the new-app route first, it's much faster.

Per the user (confirmed): the device serial itself is permanently fixed to their registration and does not
change via any self-service form field or a new Integrator PIN — the only way to get a *different device
serial* is an in-person KRA office visit. The new-Apigee-app fix above works *without* changing the device
serial at all, which is exactly why it's worth trying first.

## When something fails that isn't in `references/oscu-payload-gotchas.md`

1. Get the *raw* KRA response, not our HTTP wrapper's generic message — query `oscu_operation_logs` or
   `compliance_events.responseSnapshot` (see Step 4).
2. Test the exact same payload with a raw `curl` directly against
   `https://sbx.kra.go.ke/etims-oscu/api/v1/<endpoint>` (get a token from
   `https://sbx.kra.go.ke/v1/token/generate?grant_type=client_credentials` with HTTP Basic auth using the
   consumer key/secret) — this isolates whether it's our code or KRA's sandbox, and lets you iterate on the
   payload shape fast without restarting any server.
3. Token requests occasionally fail with a DNS/connection error for no real reason — retry once before
   concluding anything.
4. Once you find a working payload shape, **add it to `references/oscu-payload-gotchas.md`** so the next
   session doesn't rediscover it.
