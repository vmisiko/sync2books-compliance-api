# Compliance as a Self-Serve API Platform — Plan

**Date:** 2026-09-20
**Goal:** let a merchant's developer integrate eTIMS directly against `sync2books-compliance-api`, using a key
they issue themselves from the compliance dashboard, scoped to their own organisation — without ever handling
a `nest-sync-2-books-api` API key, which is a *provider* credential that reaches other organisations' ERP data.

This plan is also the foundation for the KRA go-live **Technology Architecture** upload, so §7 treats
"what we can honestly tell KRA" as a first-class constraint, not an afterthought.

---

## 1. Why this is the right shape

Today there are two ways into compliance-api:

| Mode | Caller | Credential | Who it's for |
|---|---|---|---|
| A | `nest-sync-2-books-api` | one deployment-wide bearer `COMPLIANCE_SERVICE_TOKEN` | provider-internal ERP bridge |
| B | compliance dashboard UI | dashboard JWT + `x-tenant-id` | the CFO/accountant persona |

A merchant developer fits neither. Handing them a main-API key means handing them a credential whose
Application owns companies and ERP connections belonging to other merchants. Telling them to use the dashboard
means "no API at all". So the honest third door is: **compliance issues its own keys, scoped to one
organisation's businesses.**

This is not a new idea in this codebase — `.docs/12-personas-and-platform-contract.md` §3.2 already says
compliance auth is "API key (from Sync2Books **or Compliance**) or JWT". Persona 2 was simply never built on
the compliance side.

**What stays provider-only:** the ERP connectors (QuickBooks/Odoo/Xero/Dynamics), the Link widget, the pull
and mapping engine, receipt push-back to the ERP. These continue to run through the provider's own main-API
Application. A merchant who wants ERP sync gets it as a *feature of their business*, not as an API key.

---

## 2. Baseline — what actually exists (surveyed 2026-09-18)

Grounded facts the plan has to build on. These are current-state, not assumptions.

### 2.1 compliance-api

> **P0 shipped 2026-09-20** (branch `fix/tenant-isolation-p0`): the fail-open guard, the unbound
> `merchantId`, the unscoped dashboard routes and the cross-tenant stock transfer below are now fixed. The
> baseline is kept as written because it is what the rest of this plan was designed against.

- **No global guard.** Four guard classes exist; protection is per-controller.
- `ComplianceServiceAuthGuard` (`src/integration/compliance-service-auth.guard.ts:17`) **fails open**: if
  `COMPLIANCE_SERVICE_TOKEN` is unset it returns `true` immediately. When set, it is one static secret with
  **no tenant binding** — it requires an `x-sync2books-company-id` header but never compares it to the
  `merchantId` in the payload.
- It guards `/oscu/*`, `/catalog/*`, `/api/sales/*`, `/api/stock/*`, `/compliance-organization/*`.
- **`merchantId` is a data key, never an auth subject.** Every Mode A route reads it straight from
  query/body/path. `POST /api/stock/transfer` doesn't even take a merchantId — it moves stock between branch
  ids, so two *different tenants'* branches can be named in one call.
- `ActiveTenantGuard` (`src/dashboard-identity/infrastructure/guards/active-tenant.guard.ts:24`) is the only
  real ownership check: it 403s when `tenant.organizationId !== req.user.organizationId`.
- But several JWT routes bypass it and trust `merchantId` from the request — `dashboard-api/sales`,
  `/customers`, `/suppliers`, and five handlers in `/inventory`. The code comments admit this
  (`dashboard-sales.controller.ts:43-46`).
- `compliance_tenants.organizationId` is **nullable**, and is null for any tenant created through Mode A.
- **No API-key issuance of any kind exists** — no key entity, no hashing helper, no lookup guard, no rotation.
  Greenfield.
- **HMAC verification already exists and works**: inbound main-API webhooks are verified with
  `timingSafeEqual` over the raw body (`main-api-connection.application.service.ts:507`), with `rawBody: true`
  enabled globally for exactly that reason. The secret is minted by main API, never by us.
- **`merchantId` ≡ main API `Company.id`**, established by `ensureCompany`. Resolving a merchantId for a fresh
  tenant currently *requires a live main API*.

### 2.2 main API (for contrast, and three bugs to avoid copying)

- Key model: Organization → Application → Credentials (`sk_development_…` / `sk_production_…`), stored
  **plaintext**, resolved by `ApiKeyAuthGuard`, optional HMAC only when both signature headers are present.
- **Rotation doesn't persist** — `regenerate-credentials` returns 200 but never writes the new rows, so the
  old key keeps working and the new one never authenticates.
- **`ApplicationController` has no guard**, including the route returning `apiKey`/`clientSecret`.
- **Rate limiting is an in-process Map**, and the documented `X-RateLimit-*` headers are never sent.

Design consequence: the compliance key model should **hash keys at rest, make rotation real, and emit rate
headers** — i.e. deliberately not a copy-paste of the main-API model.

---

## 3. Target architecture

```
                     ┌────────────────────────────────────────────┐
  merchant's         │  Compliance API  (sync2books-compliance-api)│
  developer ──key──▶ │                                            │──OSCU──▶ KRA eTIMS
                     │  /v1/*      ← compliance API keys (new)     │
  CFO in browser ──▶ │  /dashboard-api/*  ← dashboard JWT          │
                     │  /internal/*       ← service token (Mode A) │
                     └────────────┬───────────────────────────────┘
                                  │ optional, provider-owned
                                  ▼
                     ┌────────────────────────────────────────────┐
                     │  Main API — ERP connectors, Link, pull,     │
                     │  receipt push-back (never exposed to the    │
                     │  merchant developer)                        │
                     └────────────────────────────────────────────┘
```

Three caller classes, three credentials, one KRA path. The merchant developer never sees the bottom box.

---

## 4. Data model (new, compliance-owned)

```
compliance_applications
  id, organizationId (FK dashboard_organizations), name, description,
  status(active|suspended), rateLimitPerMin (default 120), createdByUserId, timestamps

compliance_api_keys
  id, applicationId, environment(SANDBOX|PRODUCTION),
  keyPrefix           -- e.g. "cmp_sk_test_8f2a"  (searchable, shown in UI)
  keyHash             -- sha256 of the full key; the key itself is shown ONCE
  lastFour, scopes(json), status(active|revoked), lastUsedAt, expiresAt,
  createdByUserId, revokedAt, revokedByUserId, timestamps

compliance_webhook_endpoints
  id, applicationId, url, secret, eventTypes(json), environment, status, timestamps

compliance_webhook_deliveries
  id, endpointId, eventType, payload(json), status, attempts, nextAttemptAt,
  responseCode, responseBody, signature, timestamps
```

**Key format:** `cmp_sk_test_<32 hex>` / `cmp_sk_live_<32 hex>`. Stored only as a hash — a leaked database
row cannot be replayed, unlike main API's plaintext keys.

**Scopes** (keep small at first): `catalog:read`, `catalog:write`, `sales:read`, `sales:write`,
`stock:write`, `lookups:read`. Everything else stays internal.

---

## 5. Phases

Each phase is independently shippable. P0 is the only one I'd call non-negotiable before KRA sees an
architecture document that claims tenant isolation.

### P0 — Close the tenant-isolation holes ✅ *done 2026-09-20*

1. `ComplianceServiceAuthGuard`: **fail closed**. Refuse to start (or refuse the request) when
   `COMPLIANCE_SERVICE_TOKEN` is unset outside local dev.
2. Bind Mode A calls to their asserted company: compare `x-sync2books-company-id` against the `merchantId` in
   the payload and reject a mismatch — main API already forces this on its side (`coerceMerchant`), so the
   fix is cheap and low-risk.
3. Fix the JWT routes that ignore `ActiveTenantGuard`: `dashboard-api/sales`, `/customers`, `/suppliers`, and
   the five `/inventory` handlers. Derive tenant from `@ActiveTenant()`; never from the body.
4. `POST /api/stock/transfer` / `adjust`: resolve both branches and assert they belong to the same tenant.
5. Backfill `compliance_tenants.organizationId`, then make it non-null for new rows.
6. Tests: for each surface, a spec proving org A cannot read or write org B (the repo's `tenant-scope-audit`
   skill covers exactly this).

### P1 — Compliance applications and API keys *(~1 week)*

1. Entities above + `ComplianceApiKeyGuard`: `x-api-key` → hash lookup → active key → application →
   organisation; attach `req.apiCaller = {applicationId, organizationId, environment, scopes}`.
2. `TenantScopeGuard`: every `/v1/*` route resolves the target business (by `businessId` or `merchantId`) and
   403s unless `tenant.organizationId === apiCaller.organizationId`. **One place, not per-handler.**
3. Environment binding: a `test` key may only touch businesses whose eTIMS connection is `SANDBOX`, a `live`
   key only `PRODUCTION`. This is the guard rail that stops a developer accidentally filing real tax data.
4. Rate limiting per application with real `X-RateLimit-*` headers; Redis when configured, in-process
   fallback (and say which, honestly, in the docs).
5. `Idempotency-Key` on POSTs — the document layer already has `idempotencyKey`
   (`merchantId:sourceDocumentId:documentType`), so this is mostly surfacing what exists.

### P2 — The public `/v1` surface *(~1 week)*

A deliberately small, stable API mapped onto existing use cases — not a rename of all 140 routes:

| Resource | Routes |
|---|---|
| Businesses | `GET /v1/businesses`, `GET /v1/businesses/:id` |
| Branches | `GET /v1/businesses/:id/branches` |
| Items | `POST /v1/items`, `GET /v1/items`, `POST /v1/items/:id/register` |
| Stock | `POST /v1/stock/adjustments`, `POST /v1/stock/transfers` |
| Sales | `POST /v1/sales`, `GET /v1/sales`, `GET /v1/sales/:id` |
| Credit notes | `POST /v1/credit-notes` |
| Receipts | `GET /v1/sales/:id/receipt(.pdf)`, `?copy=true` |
| Lookups | `GET /v1/lookups/classifications`, `/codes`, `/branches` |

Consistent error envelope, cursor pagination, and **`/oscu/*` stays internal** — raw OSCU pass-throughs are a
certification tool, not a product surface.

### P3 — Developer experience in the compliance dashboard *(~1 week)*

A "Developers" section: create application, create key (shown once, with copy button), rotate, revoke,
per-key `lastUsedAt`, environment switch, webhook endpoints, delivery log, and a "send a test sale" sandbox
button. Admin-only via the existing `DashboardRole`.

### P4 — Outbound webhooks to merchant systems *(~1 week)*

Events: `document.accepted`, `document.rejected`, `item.registered`, `item.registration_failed`,
`stock.synced`, `receipt.ready`. HMAC-SHA256 over the raw body, `X-Compliance-Signature`, timestamped to stop
replay, exponential backoff with a real scheduler (main API's retry cron is commented out — don't inherit
that), dead-letter visible in the dashboard. Without this, developers must poll.

### P5 — Stand compliance up without main API *(~3–4 days)*

1. Introduce `businessId` (= `compliance_tenants.id`) as the public identifier; keep `merchantId` accepted as
   an alias for backwards compatibility.
2. Allow tenant creation **without** `ensureCompany`, so a compliance-only business (exactly like the Gear
   Train one we created on 2026-09-18) is a first-class citizen rather than a half-provisioned edge case.
3. `sync2booksCompanyId` becomes the *optional ERP link*, populated only when the merchant connects an ERP.
4. **Fix the credential leak:** `GET /dashboard-api/erp/main-api-connection/link-credentials` currently
   returns the provider's main-API key unmasked to the browser. Replace with a short-lived, server-minted
   link session token.

### P6 — Documentation *(~1 week, overlaps P2–P4)*

1. New Mintlify tab: **Compliance API (direct)** — auth with compliance keys, businesses, branches, items,
   stock, sales, credit notes, receipts, webhooks, errors, rate limits, environments, idempotency.
2. Keep the existing 12 eTIMS pages as the "via Accounting API" path, and add a one-page
   "which door do I use?" decision guide.
3. Fix the stale claims: `X-RateLimit-*` headers (either implement in P1 or stop documenting them), and the
   three orphaned mdx files (`expense-management`, `attachments`, `sync-and-monitoring` — ~900 lines that
   render nowhere).
4. Generate `openapi/compliance-v1.json` for the new surface.

---

## 6. Sequencing

```
P0 ──▶ P1 ──▶ P2 ──▶ P3
              └──▶ P4
        P5 (parallel with P2)
              P6 trails P2/P4
```

P0 alone is worth shipping this week regardless of the rest: it is a live cross-tenant exposure, not a
roadmap item.

---

## 7. What this means for the KRA Technology Architecture upload

KRA asks for "Technology Architecture documentation of how integration between the Trader Invoicing System
(TIS) and eTIMS will take place". The existing PDF
(`sync2BooksDocumentation/assets/sync2books-TIS-Technology-Architecture.pdf`, v1.0) needs a v2 because:

- It is **orphaned** — nothing in the docs site links to it.
- Two claims outrun the code: "Redis" for rate limiting (it's an in-process map) and a "durable queue …
  retried until KRA acknowledges" (webhook retries exist but their cron is disabled).
- It predates both the direct-API story and the receipt/TIS template work from the September rejection.

**v2 outline:**

1. Purpose and scope; TIS ↔ OSCU ↔ eTIMS positioning.
2. System context — the three caller classes and the single KRA path (§3 diagram).
3. Component architecture — compliance-api as the sole holder of OSCU credentials (`cmcKey`, `dvcId`,
   `sdcId`) one row per branch; ERP connectors as an optional upstream.
4. Integration sequence — device initialise → code/classification sync → branch info → item registration →
   stock → sales/credit notes → purchases → receipt generation, each mapped to a module.
5. Receipt/TIS conformance — page 8/10 field mapping, COPY receipts (§11), QR verification on KRA's portal.
6. Security and credential custody — key hashing, per-organisation scoping, environment separation,
   service-to-service auth, HMAC webhooks, secrets from environment only.
7. Environments — sandbox vs production, per-branch environment tagging.
8. Reliability — retries, idempotency keys, counter self-healing (`invcNo`/`sarNo` drift), audit trail via
   `compliance_events` / `oscu_operation_logs`.
9. Glossary.

**Honesty rule:** label anything not yet shipped as "planned", or ship it first. The September rejection was
a document-versus-reality mismatch; a second one on the architecture document would be worse. Practical line:
ship P0, describe P1–P4 as the near-term roadmap, and describe the receipt pipeline (already live-verified) in
the present tense.

---

## 8. Open decisions for Victor

1. **Key prefix / naming** — `cmp_sk_live_…` vs reusing `sk_…`. Distinct prefix is safer (a leaked key is
   immediately identifiable as compliance, not accounting).
2. **Scope granularity** — six scopes as above, or start with a single `etims:write`?
3. **Does a merchant developer get sandbox access before their business is KRA-certified?** Recommend yes:
   a sandbox business tied to our own test device, otherwise they cannot build before go-live.
4. **Pricing/quota gating** — is `rateLimitPerMin` per application, or per organisation plan?
5. **Do we deprecate `merchantId` in public APIs** in favour of `businessId`, or keep both indefinitely?
6. **KRA timing** — submit the architecture document after P0 only (fastest), or wait for P1 so the key model
   is real when described?

---

## 9. Where more subagents help

- One to implement P0 per surface with tenant-isolation specs (mechanical, well-bounded).
- One to draft the `/v1` OpenAPI from the existing controllers once P2's route list is fixed.
- One to write the Mintlify pages from the OpenAPI + existing eTIMS pages.
- One to regenerate the architecture PDF from a reportlab script (the v1 PDF was built that way).
