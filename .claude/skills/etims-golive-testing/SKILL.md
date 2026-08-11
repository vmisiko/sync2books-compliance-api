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

## Step 5 — Work through the rest of the checklist

Most of the remaining 23 test cases map onto `sync2books-compliance-api`'s existing OSCU pass-through
routes (`GET/POST /oscu/*`, see `src/regulatory/oscu/presentation/oscu-operations.controller.ts`) — call
these directly with `merchantId` (the sync2books company id) and `branchId` (the sync2books branch id, e.g.
`00`). A `resultCd: "001"` ("no search result") on a lookup is a **valid pass**, not a failure — KRA's own
prior correspondence on this integration confirmed that; don't waste time trying to make lookups return
non-empty data. The compliance-api HTTP wrapper surfaces both as an error though, so check
`oscu_operation_logs` for the real `resultCd` rather than trusting the HTTP status code.

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
