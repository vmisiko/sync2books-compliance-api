# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This is `compliance-api`, the NestJS microservice that owns all KRA eTIMS/OSCU tax-submission logic for Sync2Books, isolated from the main API (`../nest-sync-2-books-api`). See the root `CLAUDE.md` (two levels up) for how this repo relates to its siblings.

## Commands

```bash
pnpm install
pnpm run start:dev               # watch mode
pnpm run start / start:prod       # runs dist/main
pnpm run build                     # nest build
pnpm run lint                       # eslint --fix over src/apps/libs/test
pnpm run test                        # jest unit tests (rootDir: src, *.spec.ts)
pnpm run test:cov
pnpm run test:debug
pnpm run test:e2e                    # jest --config ./test/jest-e2e.json (*.e2e-spec.ts)
pnpm run test:e2e:compliance         # --runInBand --testPathPattern=compliance-organization\.e2e-spec
pnpm run swagger:generate
```

Single test:
```bash
pnpm run test -- <path-or-name-pattern>
pnpm run test -- -t "<test name>"
pnpm run test:e2e -- --testPathPattern=<name>
```

`.env` is auto-loaded via `ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })` in `app.module.ts` (added 2026-08-16, matching `nest-sync-2-books-api`) — no more manual sourcing needed for `nest start`/`start:dev`. Stale `nest start --watch` processes silently keep serving old env vars/ports — kill and restart rather than trusting a running process reflects a recent env change.

There's a dedicated `etims-golive-testing` skill (`.claude/skills/`) for driving the KRA Go-Live certification checklist against this service and the main API — use it when working through KRA sandbox test cases rather than improvising the flow.

Before standing up or debugging a UAT/production deploy, read `.docs/ENVIRONMENT_SETUP_CHECKLIST.md` — covers the dev-seed fixture tenant that must not leak into a shared environment, `COMPLIANCE_SERVICE_TOKEN` failing open when unset, the shared sandbox eTIMS credential env vars, and why a fresh environment won't sync OSCU reference data until something real is connected. `NODE_ENV=production` is the Dockerfile default for every deploy including UAT — it does not distinguish UAT from real production.

## Architecture

Per `.docs/MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md` and `.docs/THREE_SERVICE_TRUST_AND_CONNECTION_ARCHITECTURE.md`: the main API calls this service **synchronously over HTTP** ("Mode A" — client → main API → compliance-api → KRA/OSCU → back up the same chain). Async queue/webhook delivery is discussed only as a future option, not implemented. Main API handles developer/API-key auth and maps `companyId` → `merchantId`/branch ids before forwarding; this service is the source of truth for OSCU execution state (`cmcKey`, `deviceId`, submission outcomes), while main API remains the source of truth for the integration/connection catalog. Calls from main API are authenticated via `ComplianceServiceAuthGuard` checking a bearer token (unenforced locally unless `COMPLIANCE_SERVICE_TOKEN` is set).

A second, separate auth path ("Mode B") exists for the compliance dashboard UI (`Next-Sync-2-books-compliance-dashboard-ui`), which talks to this service directly — never through the main API.

**Document/invoice lifecycle** — two docs describe this and disagree; check both before assuming one is authoritative:
- `.docs/00-COMPLIANCE-CORE-ARCHITECTURE.md`: `DRAFT → VALIDATED → READY_FOR_SUBMISSION → SUBMITTED → {ACCEPTED, REJECTED, FAILED}`, with `REJECTED → RETRYING → SUBMITTED`. Invariants: can't reach ACCEPTED without SUBMITTED; lines freeze after VALIDATED; historical invoices are immutable; every KRA response is stored as a `ComplianceEvent`.
- `.docs/06-document-lifecycle-and-state-machine.md`: `DRAFT → VALIDATED → ITEM_SYNC_REQUIRED → PENDING_SUBMISSION → SUBMITTED → RECONCILED`, with `FAILED_SUBMISSION`/`FAILED_VALIDATION` branches.

Idempotency key across submissions: `merchantId:sourceDocumentId:documentType`.

**OSCU/eTIMS**: KRA's Online Sales Control Unit spec — every Kenyan business must integrate with it to register items, report stock, and submit sales/credit-note transactions to the tax authority in real time. Hard-won payload gotchas (`.claude/skills/etims-golive-testing/references/oscu-payload-gotchas.md`):
- `itemCd` must strictly increment from 1 per tin — never reused or random; nested `qtyUnitCd` must be exactly 2 chars (`"NO"`, not `"U"`).
- All amounts in `insertStockIO`/`sendSalesTransaction`/purchase payloads are tax-inclusive: `taxblAmt = total / 1.16`, `taxAmt = total - taxblAmt` — never add tax on top.
- `bhfId` must be KRA's real branch code (`connection.kraBhfId`), never sync2books's internal branch id.
- `orgSarNo`/`orgInvcNo` must be `0`, never `null` (KRA's backend NPEs on null).
- `invcNo`/`sarNo` counters only advance on KRA ACCEPTED responses — roll back local counters on rejection or they drift from KRA's.
- Apigee sometimes wraps a real rejection in an outer HTTP 200 — check `responseHeader.responseCode`, not HTTP status.
- Some lookups (`selectStockMoveList`, `getPurchaseTransactionInfo`) need `tin`/`bhfId` duplicated in the JSON body even though already in headers.
- `resultCd: "001"` ("no result") is a valid pass for lookups, not a failure.

**DB**: TypeORM, `synchronize: true` in `app.module.ts` and every spec's test module — there is no migrations directory; schema is fully auto-synced from entities. Supports MySQL (`mysql2`) for real use; `better-sqlite3`/`sql.js` are also deps, likely for lightweight/test scenarios. `StockRepositoryStub` inventory is in-memory only and resets on restart.

Root-level `KRA_BUG_REPORT_URGENT_2026-08-13.md`, `KRA_SUPPORT_TICKET_DRAFT.md`, `KRA_SUPPORT_TICKET_DRAFT_2.md` document an active, unresolved KRA-side sandbox incident (device serial `JM9QLXNJ75`'s `/initialize` call returning an ambiguous-record error that worsens on retry, now spreading to `saveItem`) — confirmed KRA-side across multiple pins/apps, not fixable client-side. Don't re-call `/initialize` on that device serial while this is open; check those files for current status before assuming it's resolved.
