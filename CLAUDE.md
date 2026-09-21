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

Per `.docs/MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md` and `.docs/THREE_SERVICE_TRUST_AND_CONNECTION_ARCHITECTURE.md`: the main API calls this service **synchronously over HTTP** ("Mode A" — main API → compliance-api → KRA/OSCU → back up the same chain). Async queue/webhook delivery is discussed only as a future option, not implemented. This service is the source of truth for OSCU execution state (`cmcKey`, `deviceId`, submission outcomes), while main API remains the source of truth for the integration/connection catalog. Calls from main API are authenticated via `ComplianceServiceAuthGuard` checking a bearer token — required outside local development (it refuses the request when unset with `NODE_ENV=production`), still optional on a dev machine. When enforced, `AssertedMerchantGuard` also requires the payload's `merchantId` to equal the `x-sync2books-company-id` header. On the dashboard side, `MerchantOwnershipGuard` verifies a `merchantId` in the request belongs to the caller's organization.

**Mode A is internal-only as of 2026-09-21.** The main API's public eTIMS routes and the developer-console UI that drove them were removed; eTIMS is integrated through this platform and its own API keys, not through the main API. What still arrives over Mode A comes from in-process callers on that side — the OPERA fiscalisation path and the receipt attach-back sync handler. Those two docs still describe the main API as the developer's entry point; treat that part as historical. Don't add a public eTIMS route to the main API — the developer surface belongs here.

A second, separate auth path ("Mode B") exists for the compliance dashboard UI (`Next-Sync-2-books-compliance-dashboard-ui`), which talks to this service directly — never through the main API.

**Developer API (P1 + P2, built 2026-09-21; `src/developer-platform/`).** A merchant organisation creates an *application* and issues *API keys* (`cmp_sk_test_…` / `cmp_sk_live_…`, stored only as a SHA-256 hash, shown once) through `dashboard-api/developer/*` (session-authenticated). The public surface is `/v1/*`, every controller mounted with the `@V1Api()` decorator (`presentation/v1/v1-api.decorator.ts`) so none can forget a guard: `ComplianceApiKeyGuard` (authenticate + `@RequireScopes`) → `ApiRateLimitGuard` (per-application, real `X-RateLimit-*`; Redis when `COMPLIANCE_RATE_LIMIT_REDIS_URL`/`ETIMS_OSCU_REDIS_URL` is set, per-process otherwise, logged at warn) → `TenantScopeGuard` (business must belong to the key's organisation **and** its eTIMS environment must match the key's) + `V1ExceptionFilter` (one `{ error: { code, message } }` shape, guard failures included). Routes: `me`, `businesses[/:id[/branches]]`, `items[/:id[/register]]`, `stock/{adjustments,transfers}`, `sales[/:id[/receipt|/retry]]`, `credit-notes` (full reversal only), `lookups/{classifications,code-classes,codes}`. Rules that are easy to get wrong when adding a route:
- **Every resource route needs an explicit `businessId`** (query or body) and reads it only through `@RequiredApiTenantId()` — never `body.businessId`/`merchantId`, which a caller can send alongside a different one. `TenantScopeGuard` alone leaves a request naming no business untouched.
- **Every id a route accepts goes through `V1ScopeService`** (`requireItem(s)`, `requireSale`, `resolveBranch`) — a foreign id is always a 404, never a 403. The services underneath do NOT do this: `createDocument` never compares an item's merchant to the document's, stock adjust takes no taxpayer at all, and `getDocument`/`listNormalizedSaleReports`' cursor resolve by bare id. They were safe behind the internal service token; they are not safe behind an API key.
- **Never return the service's own report/outcome objects.** Build responses in `v1-views.ts` from an allow-list (the sale report carries an internal route, the device serial and ERP attachment state; stock outcomes carry the raw OSCU request/response).
- **No global ValidationPipe exists** and the DTOs are Swagger-only — read input through `v1-input.ts`, which rejects a numeric string where a number is expected.
- **Sale documents are stored tax-inclusive with `taxAmount` 0** (subtotal = total = Σ qty×unitPrice). The structural validator wants `total = subtotal + tax`; splitting VAT out of an inclusive price fails it (found live). KRA and the receipt derive the split from each line's tax type. Credit notes mirror the original's own convention.
- KRA's verdict is a status on the document, not an exception: 201 accepted / 202 in flight / **422 `kra_rejected`** (never a 2xx for a refused fiscal document), with the sale attached so it can be retried. `retrySales` treats an omitted `documentIds` as "every retryable document for the tenant" — always pass the one owned id.
Not built: the dashboard Developers UI (P3), outbound webhooks (P4), partial credit notes, `Idempotency-Key` replay of a changed body (a replay returns the original, unchanged). Public docs for `/v1` are P6 and not written — the docs site still says the developer API is being finalised. Plan: `.docs/COMPLIANCE_SELF_SERVE_API_PLATFORM_PLAN.md`.

**Published docs never describe internal topology.** `.docs/TIS_TECHNOLOGY_ARCHITECTURE_V2.md` is submitted to KRA and rendered onto the public docs site (`sync2BooksDocumentation/etims-architecture.mdx`, PDF built by its `scripts/build-architecture-pdf.py`). It deliberately omits internal service names, Mode A/B, service tokens, internal headers and this service's own session-authenticated routes — they aren't part of any integration contract, and publishing them widens the attack surface around taxpayers' KRA device credentials. State controls there by what they guarantee, not by which guard implements them. This file, by contrast, is internal and should stay concrete.

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
