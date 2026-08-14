---
name: etims-golive-testing
description: Drives the KRA eTIMS OSCU Go-Live certification testing workflow for Sync2Books end-to-end — standing up compliance-api and nest-sync-2-books-api locally, provisioning new Go-Live credentials (Apigee App ID, Application Test Pin, device serial), and working through the 23-test-case checklist on developer.go.ke. Use this whenever the user wants to test the eTIMS/OSCU Go-Live checklist, drive the KRA sandbox tests, provision a new Application Test Pin for Sync2Books, or debug a failing OSCU endpoint (saveItem, insertStockIO, sendSalesTransaction, credit notes, etc.) — even if they just paste new credentials and say "try again" or share a screenshot of the developer.go.ke test dashboard. Encodes a full session's worth of hard-won debugging (payload shapes, sequencing bugs, environment gotchas) so it doesn't get rediscovered from scratch.
---

# eTIMS Go-Live Testing (Sync2Books)

This project integrates Sync2Books with Kenya's eTIMS tax system via KRA's OSCU sandbox. Getting through
KRA's 23-test-case Go-Live checklist (tracked at `developer.go.ke/myapps/testcases/...`) requires driving
real HTTP calls through `sync2books-compliance-api` → KRA's sandbox, and often `nest-sync-2-books-api` in
front of it. The sandbox is flaky and its request formats diverge from its own documentation in specific,
previously-discovered ways — this skill exists so those aren't rediscovered by trial and error every time.

**Read `references/oscu-payload-gotchas.md` before making direct OSCU calls (saveItem, insertStockIO,
saveStockMaster, sendSalesTransaction, credit notes)** — it has the exact request shapes that work and why
the "obvious" version of each fails.

## The three repos

This skill lives inside `sync2books-compliance-api/.claude/skills/`. All four project folders below
(including that one) are siblings under one parent workspace directory — commands in this skill that `cd`
into a project folder assume you start from that shared parent, not from inside `sync2books-compliance-api`
itself. If unsure where that parent is, it's the directory containing `sync2books-compliance-api/.claude/`
that this very file lives under (two levels up from `SKILL.md`) — use `pwd`/`find` to confirm before running
the `cd` commands below rather than assuming.

- `sync2books-compliance-api` (NestJS) — talks directly to KRA's sandbox
  (`https://sbx.kra.go.ke/etims-oscu/api/v1`, integrator path style). Needs its own MySQL.
- `nest-sync-2-books-api` (NestJS, "main API") — sits in front of compliance-api. Has a **direct REST API**
  for items/sales/credit-notes at `/companies/:companyId/integrations/etims/*` (x-api-key auth) — no
  QuickBooks connection required. Needs its own MySQL + Redis.
- `sync2books-react` — dashboard UI. Not useful for driving tests; it has no manual item/invoice creation
  screen, only sync monitoring.

Prefer testing through `nest-sync-2-books-api`'s direct API when you need the full item→sale→credit-note
flow (it exercises the same code paths a real integration would). Fall back to calling
`sync2books-compliance-api` directly, or raw `curl` against KRA's sandbox, when isolating whether a bug is
in our code or in KRA's backend.

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
- Apigee OAuth consumer key + secret (these usually stay constant across Application Test Pin rotations —
  ask the user to confirm before requesting them again)

**If the user says they've generated a new Application Test Pin without saying anything else changed**,
assume device serial / Apigee App ID / consumer key+secret are unchanged and only ask for what's different.

## Step 2 — Stand up the environment

Check what's already running before redoing setup — state may survive between sessions:

```bash
docker ps -a --format "{{.Names}}: {{.Status}}"
curl -s -o /dev/null -w "compliance-api: %{http_code}\n" http://localhost:3001/docs
curl -s -o /dev/null -w "nest-api: %{http_code}\n" http://localhost:3000/health
```

If containers exist but are stopped, `docker start <name>` brings them back with data intact (as long as
they were never `docker rm`'d — no `-v` volume was used, so data lives in the container's writable layer).
If Docker itself is down, `open -a Docker` and wait for `docker info` to succeed before proceeding.

**If nothing exists yet**, create isolated containers (don't touch any pre-existing local MySQL install —
it may belong to a different user/project on a shared machine):

```bash
docker run -d --name sync2books-compliance-mysql -e MYSQL_ROOT_PASSWORD=password \
  -e MYSQL_DATABASE=compliance -p 3307:3306 mysql:8.4
docker run -d --name sync2books-api-mysql -e MYSQL_ROOT_PASSWORD=password \
  -e MYSQL_DATABASE=sync_to_books -p 3308:3306 mysql:8.4
docker run -d --name sync2books-api-redis -p 6380:6379 redis:7-alpine
```

If the image pull or MySQL init fails, add `--platform linux/arm64` or `linux/amd64` to match `uname -m` —
this project has hit `mysqld` init errors from a platform mismatch before.

### compliance-api `.env`

NestJS here does **not** auto-load `.env` (no dotenv/ConfigModule) — you must export the vars into the
shell before `pnpm start`. Write `sync2books-compliance-api/.env`:

```
ETIMS_ADAPTER_MODE=http
ETIMS_OSCU_PATH_STYLE=integrator
ETIMS_OSCU_SANDBOX_BASE_URL=https://sbx.kra.go.ke/etims-oscu/api/v1
ETIMS_OSCU_APIGEE_CLIENT_ID=<consumer key>
ETIMS_OSCU_APIGEE_CLIENT_SECRET=<consumer secret>
ETIMS_OSCU_APIGEE_APP_ID=<Apigee App ID>
ETIMS_STOCK_SYNC=true
ETIMS_STOCK_MASTER_SYNC=true
DB_HOST=127.0.0.1
DB_PORT=3307
DB_USERNAME=root
DB_PASSWORD=password
DB_DATABASE=compliance
PORT=3001
NODE_ENV=development
```

Start it in its **own, isolated Bash call**:

```bash
cd sync2books-compliance-api
set -a; source <(grep -v '^#' .env | grep -v '^$'); set +a
nohup pnpm start > /tmp/compliance-api.log 2>&1 &
disown
```

⚠️ **Do not start nest-api in the same shell chain.** `set +a` stops *future* assignments from
auto-exporting, but variables already exported (from sourcing compliance-api's `.env`) stay exported for
the rest of that shell process. If you `cd` into `nest-sync-2-books-api` and `pnpm start` in the same Bash
call, it inherits compliance-api's `PORT`/`DB_*` and fails with `EADDRINUSE` or connects to the wrong
database. Always start nest-api in a fresh Bash tool call.

### nest-sync-2-books-api `.env`

This one *does* auto-load `.env` via `@nestjs/config`. Write it (new Bash call):

```
NODE_ENV=development
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3308
DB_USERNAME=root
DB_PASSWORD=password
DB_DATABASE=sync_to_books
REDIS_HOST=127.0.0.1
REDIS_PORT=6380
JWT_SECRET=local-dev-jwt-secret-change-me
JWT_EXPIRES_IN=7d
COMPLIANCE_API_BASE_URL=http://localhost:3001
COMPLIANCE_SERVICE_TOKEN=local-dev-service-token
```

`COMPLIANCE_SERVICE_TOKEN` can be any non-empty string — compliance-api's own auth guard
(`ComplianceServiceAuthGuard`) only enforces a matching token if *its own* `COMPLIANCE_SERVICE_TOKEN` env
var is set, which it isn't in local dev, so it accepts anything nest-api sends.

```bash
cd nest-sync-2-books-api
nohup pnpm start > /tmp/nest-api.log 2>&1 &
disown
```

Verify both: `curl localhost:3001/docs` and `curl localhost:3000/health` should return 200. If not, check
`/tmp/compliance-api.log` / `/tmp/nest-api.log` — `grep -iE "error" | grep -v "^query:"` cuts through the
TypeORM query noise.

**⚠️ compliance-api's stock inventory is in-memory** (`StockRepositoryStub`), not persisted to MySQL — it
resets to zero every time you restart the server. If you restart compliance-api mid-session, re-run the
stock steps in Step 4 before testing sales again, or you'll chase a phantom "insufficient stock" bug that
isn't really a bug.

## Step 3 — Provision the connection

Via nest-api's direct API (create an org/application/company once, reuse across sessions if they already
exist — check first):

```bash
# One-time: sign up, create an application, get an x-api-key
curl -s -X POST http://localhost:3000/auth/signup -H "Content-Type: application/json" -d '{...}'
curl -s -X POST http://localhost:3000/organizations/$ORG_ID/applications -H "Authorization: Bearer $JWT" -d '{"name":"Go-Live Test App","type":"SERVER"}'
curl -s -X POST http://localhost:3000/organizations/$ORG_ID/applications/$APP_ID/regenerate-credentials -H "Authorization: Bearer $JWT"
# -> take the "development" environment's apiKey

# Per Go-Live session: create a company, provision eTIMS
curl -s -X POST http://localhost:3000/companies -H "x-api-key: $API_KEY" -d '{"name":"Go-Live Test Company"}'
curl -s -X POST http://localhost:3000/companies/$COMPANY_ID/integrations/etims/provision \
  -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"kraPin":"<Application Test Pin>","environment":"SANDBOX","dvcSrlNo":"<device serial>","kraBhfId":"00"}'
```

`provision` creates the branch and chains through compliance-api's tenant → branch → etims-connection →
`/initialize`. **This is the only `/initialize` call you should make per device+PIN combination** — see the
device-corruption warning below before considering a second one.

If it fails with `"OSCU 902 This device is installed"`, the device was already initialized for this exact
PIN in a prior attempt (e.g. a retried script). Don't re-initialize — find the earlier `cmcKey`/`deviceId`
(check `oscu_operation_logs` or your own shell history) and patch the DB row directly instead:

```bash
docker exec sync2books-compliance-mysql mysql -uroot -ppassword compliance -e "
UPDATE compliance_etims_connections SET cmcKey='<known cmcKey>', deviceId='<known deviceId>'
WHERE kraPin='<pin>';"
```

## Step 4 — Register an item and stock, then run the flow

Once provisioned, drive the full flow through nest-api's direct API:

```bash
# Item
curl -s -X POST http://localhost:3000/companies/$COMPANY_ID/integrations/etims/catalog/items \
  -H "x-api-key: $API_KEY" -d '{"externalId":"...","name":"...","itemType":"GOODS","taxCategory":"VAT_STANDARD","classificationCode":"<a real code>","unitCode":"EA"}'
curl -s -X POST http://localhost:3000/companies/$COMPANY_ID/integrations/etims/catalog/items/sync \
  -H "x-api-key: $API_KEY" -d '{"branchId":"00"}'
```

Pull real classification codes first if you don't have one handy —
`POST http://localhost:3001/catalog/item-classifications/sync` with `{"merchantId","branchId":"00","full":true}`
against compliance-api, then `GET /catalog/item-classifications?limit=5`.

**Before any sale**, stock must exist in *two* places — locally (gates our own validation) and in KRA's own
Stock Information Management (gates their `sendSalesTransaction` check):

```bash
# Local (compliance-api) -- pass unitPrice or the eTIMS sync below is skipped, not sent with zeros
curl -s -X PUT http://localhost:3001/api/stock/adjust -H "Content-Type: application/json" \
  -d '{"itemId":"<item id>","branchId":"00","quantity":100,"action":"ADD","unitPrice":100}'
```

This also pushes `insertStockIO`/`saveStockMaster` to KRA automatically
(`ETIMS_STOCK_SYNC`/`ETIMS_STOCK_MASTER_SYNC`). It used to be unconditionally broken because generic stock
adjustments carry no unit price and KRA rejects a zero `totAmt` -- fixed 2026-08-11 by adding an optional
`unitPrice` to `PUT /api/stock/adjust` / `POST /api/stock/transfer` (and to `recordMovement()` internally).
With a `unitPrice`, `InventoryService.syncStockMovementToEtims()` computes real tax-inclusive `splyAmt`/
`taxblAmt`/`taxAmt` (same `splitTaxInclusiveAmount()` rule as sales, see below) and sends a valid request.
Without one, it now logs a clear `WARN` and skips the call entirely instead of sending a doomed zero-amount
request. If you still see a `WARN` with `unitPrice` supplied, it's a real KRA-side rejection -- check
`compliance-api.log` (see note on reading `HTTP 400 calling OSCU` below) and cross-reference
`references/oscu-payload-gotchas.md`.

**✅ RESOLVED 2026-08-12: `insertStockIO`/`saveStockMaster` confirmed working live end-to-end**, including a
real downstream `sendSalesTransaction` success (`receiptNumber`, `receiptSignature`, `etimsUrl` all
populated). This had been misdiagnosed for nearly 24 hours as an unfixable KRA sandbox-side issue -- it was
actually three real client-side bugs, found by dropping to raw `curl` direct against KRA's sandbox
(bypassing this codebase) when the error kept looking too vague to be a genuine payload problem. **The
primary cause: `InventoryService`'s stock sync methods were sending the wrong `bhfId` HTTP header** (the
sync2books-side branch id instead of KRA's real `kraBhfId`) -- see `references/oscu-payload-gotchas.md`'s
`insertStockIO` section for the full writeup (also two smaller payload bugs, and a related `postOscu()` fix
for Apigee wrapping business rejections in an outer HTTP 200). **If you hit a persistent, vague OSCU error
that doesn't budge across retries, try raw `curl` against KRA's sandbox directly before concluding it's
KRA-side** -- that's what actually cracked this.

Then the sale, and — once `complianceStatus` is `ACCEPTED` — a credit note referencing it:

```bash
curl -s -X POST "http://localhost:3000/companies/$COMPANY_ID/integrations/etims/sales?submit=true" \
  -H "x-api-key: $API_KEY" -d '{"branchId":"00","saleDate":"YYYY-MM-DD","traderInvoiceNumber":"...","receiptTypeCode":"S","paymentTypeCode":"01","invoiceStatusCode":"02","items":[{"id":"<item id>","quantity":1,"unitPrice":100,"taxCategory":"VAT_STANDARD","taxAmount":16}]}'

curl -s -X POST "http://localhost:3000/companies/$COMPANY_ID/integrations/etims/sales/credit-notes/express" \
  -H "x-api-key: $API_KEY" -d '{"branchId":"00","saleId":"<the sale doc id>","traderInvoiceNumber":"...","returnDate":"YYYY-MM-DD"}'
```

Check outcomes in the compliance-api DB, not just the HTTP response (nest-api's sync is async):

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

Most of the remaining 23 test cases map onto `sync2books-compliance-api`'s existing OSCU pass-through
routes (`GET/POST /oscu/*`, see `src/regulatory/oscu/presentation/oscu-operations.controller.ts`) — call
these directly with `merchantId` (the sync2books company id) and `branchId` (the sync2books branch id, e.g.
`00`). A `resultCd: "001"` ("no search result") on a lookup is a **valid pass**, not a failure — KRA's own
prior correspondence on this integration confirmed that; don't waste time trying to make lookups return
non-empty data. The compliance-api HTTP wrapper surfaces both as an error though, so check
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
  they're what actually gets submitted with the Go-Live application.

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
