# Compliance embedded in Sync2Books — implementation gap & sequencing

**Purpose:** State what is **specified in architecture docs** but **not yet implemented in code**, and define the **order of work** so you **seal the synchronous service-to-service loop first**, then build **Sync2Books React** ETIMS connector UIs.

**Related (read first):**

- [11-sync2books-compliance-inter-service-sla-and-communication-spec.md](./11-sync2books-compliance-inter-service-sla-and-communication-spec.md) — modes, sync HTTP preference, headers, SLAs.
- [THREE_SERVICE_TRUST_AND_CONNECTION_ARCHITECTURE.md](./THREE_SERVICE_TRUST_AND_CONNECTION_ARCHITECTURE.md) — Mode A (main API → Compliance) vs Mode B (dashboard).
- [ETIMS_INTEGRATOR_PROVISIONING.md](./ETIMS_INTEGRATOR_PROVISIONING.md) — two-layer connection model, correlation ids.
- [MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md](./MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md) — **normative** Sync2Books API surface + Compliance callee map (this gap doc references it for contracts).

---

## 1. Execution principle: **synchronous loop first**

Align with **§4.1** of the inter-service SLA spec:

- **Provisioning and operational calls** from Sync2Books **main API** to **Compliance API** use **synchronous HTTP** in the first implementation phase.
- **Async jobs / queues / webhooks** are **out of scope for “sealing the loop”** unless required for timeout (then: still **sync** request that **returns 202 + job id** is optional; prefer **sync completion** for connect + init while KRA latency allows).

**Goal of “sealed loop”:** A single **server-side** path exists: **validated caller (main API)** → **Compliance** → **response** → **main API** maps status for the platform connection **without** requiring the React app to call Compliance directly.

---

## 2. What exists today (Compliance API)

These are **implemented** in `compliance-api/` (non-exhaustive, relevant to embedded mode):

| Capability | Compliance routes (prefix as deployed) |
|------------|------------------------------------------|
| Tenant / branch / eTIMS shell / initialize | `compliance-organization/...` ([usage-manual/COMPLIANCE_ORGANIZATION_USAGE.md](./usage-manual/COMPLIANCE_ORGANIZATION_USAGE.md)) |
| Catalog items | `catalog/...` |
| Sales (developer-style) | `api/sales/...` |
| Sales (dashboard-style) | `dashboard-api/sales/...` |
| Stock | `api/stock/...` |

**Mode A trust** (service token + context headers) on Compliance is **not fully implemented as a global guard** everywhere; the contract doc defines the **target** behavior.

### 2.1 Sync2Books main API — ETIMS provisioning (started)

Implemented in **`api/`** (April 2026):

- **`IntegrationKeyType.ETIMS`** (`'etims'`) and **integration catalog** entry under category **compliance**.
- **`ComplianceModule`**: `ComplianceHttpService` (calls Compliance with Bearer + `x-sync2books-*` headers) and **`POST /companies/:companyId/integrations/etims/provision`** (creates **PENDING** connection → Compliance tenant → branch → ETIMS shell → **initialize** → **CONNECTED**).
- **Env:** `COMPLIANCE_API_BASE_URL`, **`COMPLIANCE_SERVICE_TOKEN`**, optional `COMPLIANCE_HTTP_TIMEOUT_MS` — see [`api/.docs/README`](../../api/.docs/README.md).

**Still outstanding** on **main API:** thin proxies for **catalog / sales / stock**. **Compliance** must still **validate** forwarded credentials (Mode A guard). **`sync2books-react`** UX remains **TBD**.

---

## 3. What is **missing** (main API + platform)

This is the **documentation of the gap**: items called out in specs but **absent or incomplete** in the **`api/`** repository and **integration catalog** for ETIMS. **See §2.1 for what is already implemented.**

| Gap | Spec / intent | Code reality |
|-----|----------------|--------------|
| ETIMS as **integration** key + catalog | ETIMS provisioning | **§2.1** (`etims`). |
| ETIMS **connection** lifecycle on platform | PENDING → CONNECTED | **§2.1** (`provision`). |
| **HTTP client** to Compliance | Sync HTTP §4.1 | **§2.1** (`ComplianceHttpService`). |
| **Provisioning** orchestration | Tenant / branch / init | **§2.1** (`provision`). |
| **Operational proxies** | Catalog, sales, stock | **Open** — not implemented in `api` yet. |
| **Mode A validation** | Compliance verifies token + headers | **Open** — Compliance must enforce; main API sends them. |
| **React / dashboard** ETIMS UX | Embedded product | **Open** (`sync2books-react`). |

OAuth-shaped **Connection** entity (tokens + `bookCompanyId`) is a **mismatch** for ETIMS; specs already allow **metadata in `connectionResponse` JSON** and **non-OAuth** connectors — that mapping must be **documented in implementation** when adding `etims` (see contract doc).

---

## 4. Sequencing roadmap (recommended)

### Phase 1 — **Seal synchronous S2S loop** (no mandatory React change)

1. **Extend main API domain**  
   - Add `etims` (name TBD) to **integration key** enum / catalog.  
   - Define connection **status** semantics: e.g. `pending_provisioning`, `active`, `error` (reuse or extend `ConnectionStatus`).

2. **Config & client**  
   - `COMPLIANCE_API_BASE_URL`, `COMPLIANCE_SERVICE_TOKEN` (or JWT issuer config).  
   - Implement **ComplianceHttpClient** (fetch/axios) with timeouts, retries policy per SLA doc.

3. **Implement contract routes** (see [MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md](./MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md))  
   - **Provisioning:** create/update platform connection → call Compliance tenant/branch/etims/initialize chain.  
   - **Operational:** forward catalog + sales + stock (as needed) using **merchantId / branchId** mapping rules.

4. **Compliance Mode A enforcement**  
   - Middleware/guard on **integration-facing** Compliance routes: validate service token + required context headers.

5. **Smoke tests**  
   - E2E: main API forwards one **register item**, one **sale** (stub adapter), asserting **same correlation ids** round-trip.

**Exit criteria Phase 1:** Developer can use **main API only** (API key → company scope) to complete **ETIMS connect + initialize + one compliance operation** without calling Compliance URLs from outside the backend.

---

### Phase 2 — **Sync2Books React** (integrations UI)

1. Add **ETIMS** card next to QuickBooks/Xero/Sage (company / application scope).  
2. Forms capture **PIN, environment, branches + `kraBhfId`, `dvcSrlNo`** (per branch), following Compliance usage manual semantics.  
3. React calls **main API only** (`api/`), which executes Phase 1 forwards (no browser → Compliance for embedded product).  
4. Surface **connection status** and last error from main API **connection** resource.

**Exit criteria Phase 2:** Non-developer admin can **establish ETIMS** from the platform dashboard with the same connection model as other integrations.

---

### Phase 3 (later) — **Optional hardening**

- Webhooks: Compliance → main API on submission final state.  
- Async provisioning with **sync** “status poll” from React via main API.  
- Dedicated **Compliance Dashboard** product (Mode B) remains separate; must **link** by `sync2booksCompanyId` per [ETIMS…](./ETIMS_INTEGRATOR_PROVISIONING.md) §6.

---

## 5. Document maintenance

When main API implements a row in **§3**, update this file or remove the row and point to `api/` OpenAPI / README.

**Contract details** (paths, headers, bodies) live in [MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md](./MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md) — not duplicated here.
