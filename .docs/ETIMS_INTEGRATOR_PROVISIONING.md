# ETIMS Integrator: Provisioning & Cross-Service Mapping

This document describes how **ETIMS** is modeled as a **Sync2Books integrator** (same product pattern as QuickBooks), how **provisioning** creates or links records on the **Compliance** side, and how to avoid duplicate masters or divergent connection state.

**Related:** [THREE_SERVICE_TRUST_AND_CONNECTION_ARCHITECTURE.md](./THREE_SERVICE_TRUST_AND_CONNECTION_ARCHITECTURE.md) (auth Mode A vs B, trust boundaries).

---

## 1. Goals

1. Developers integrate **ETIMS / OSCU compliance** through **Sync2Books API** using existing **API keys, apps, webhooks, and monitoring**—the same commercial and technical story as other ERP connectors.
2. **Compliance API** remains the **system of record** for OSCU execution: `ComplianceConnection`, mappings, submissions, regulatory payloads.
3. **One logical ETIMS integration** per Sync2Books company: two layers (platform connection vs compliance connection) stay **linked** and **idempotent**.
4. **Dashboard** (Mode B) and **developer/API** (Mode A) can both manage the **same** underlying compliance connection where policy allows—not two unrelated ETIMS worlds.

---

## 2. Two layers: platform connection vs compliance connection

| Concept | Where it lives | Purpose |
|--------|----------------|---------|
| **ETIMS integrator / connection (Sync2Books)** | Main API (`api/`) | Developer-facing: “this company has ETIMS enabled,” billing, permissions, webhooks, connection status in the **integration catalog**. |
| **Compliance tenant / business (optional but recommended)** | Compliance API | Stable **tenant** for data isolation, display name, audit; keyed by Sync2Books identifiers. |
| **ComplianceConnection** | Compliance API | **OSCU runtime**: KRA PIN, `bhfId`, device, `cmcKey`, environment, optional Apigee fields—everything `EtimsConnectionContext` needs. |

**Rule:** Sync2Books never becomes the long-term store for raw OSCU secrets if Compliance already persists them—**delegate** and **reference** (IDs + status) on the main API side.

---

## 3. Identifiers & mapping

### 3.1 Stable correlation

Every provisioning flow should carry immutable keys from Sync2Books:

- `sync2booksOrganizationId` (or account id) — optional, for org-level policy.
- `sync2booksCompanyId` — **tenant** for “this business” in integration terms.
- `sync2booksConnectionId` — the **ETIMS integrator connection** row created in the main API (recommended as foreign key on Compliance).

On Compliance:

- **ComplianceTenant** (or `Business`) — `id`, `sync2booksCompanyId` (unique), optional display fields; created **once**, idempotent.
- **ComplianceConnection** — unique per **(compliance tenant, integrator profile)** e.g. one row for ETIMS for that company; includes `sync2booksConnectionId` if you need strict 1:1 with main API.

### 3.2 Branch mapping (not assumed 1:1)

- Sync2Books may have **many branches/locations**; KRA/OSCU uses **`bhfId`** per branch office.
- Model an explicit map: `sync2booksBranchId` (or location id) ↔ `bhfId` + metadata, with validation at submit time.
- Do not assume “create company” implies all branches are ETIMS-ready.

---

## 4. Provisioning flow (high level)

**Trigger:** User or developer **creates or activates** an **ETIMS connection** on Sync2Books for an **existing company**.

**Desired behavior:**

1. **Idempotent:** Re-running connect does not create duplicate tenants or duplicate `ComplianceConnection` rows.
2. **Ordered:** Prefer **async job** (queue/outbox) for heavy steps (Compliance tenant create, optional OSCU `initialize`, code sync).
3. **Status surfaced** on the Sync2Books connection: `pending_provisioning` → `active` / `error` with message.

**Suggested steps:**

1. Main API persists **ETIMS connection** record (status `pending_provisioning`).
2. Main API calls Compliance **internal API** (Mode A) or enqueues a worker that calls Compliance with:
   - `sync2booksCompanyId`, `sync2booksConnectionId`, optional branch list.
3. Compliance:
   - **Upsert** `ComplianceTenant` by `sync2booksCompanyId`.
   - **Upsert** `ComplianceConnection` for ETIMS (or create empty shell until secrets are supplied).
4. Optional: run OSCU **initialize** / code list sync when credentials are present.
5. Main API updates connection status from Compliance callback or polling.

**Failure handling:** Partial failure (tenant created, connection incomplete) must be **recoverable**; store last error and allow retry from either Sync2Books or Compliance dashboard.

---

## 5. Sync2Books API surface (developer)

Expose **ETIMS** operations on the **main API** the same way you expose QuickBooks-adjacent operations:

- Namespaced routes (e.g. `/companies/:id/integrations/etims/...` or consistent with existing connector patterns).
- Controllers are **thin**: validate **API key / app / company scope**, apply rate limits, then **call Compliance API** for items, sales submission, stock, etc.
- **Do not** duplicate OSCU mapping logic in two services; Compliance owns adapter + DTOs.

This is how you **sell ETIMS integrations** as part of the **same developer product** as other ERP integrations.

---

## 6. Dashboard (Mode B)

- Users authenticate with **Compliance-issued** tokens (or your BFF pattern).
- **Same** `ComplianceConnection` (and tenant) as Mode A when the company is the same—enforce with unique constraints and policy (who may create vs edit).
- If dashboard connects ETIMS **before** any API provisioning, the next Sync2Books “connect” should **link** to existing Compliance rows by `sync2booksCompanyId`, not create duplicates.

---

## 7. Anti-patterns to avoid

| Anti-pattern | Why it hurts | Prefer |
|--------------|--------------|--------|
| Two unrelated `ComplianceConnection` rows for the same company (dashboard vs API) | Drift, wrong branch, double billing | Unique key + merge on link |
| Two “company masters” with different names/status | Support and audit confusion | Compliance tenant mirrors Sync2Books id; minimal extra fields |
| Synchronous HTTP only for full provisioning | Timeouts, partial state | Async jobs + idempotent retries |
| Main API stores full `cmcKey` / device secrets long-term | Duplication, leak surface | Compliance store + reference |
| Branch assumed equal to ERP branch without mapping | Wrong `bhfId`, submission errors | Explicit branch map |

---

## 8. Checklist before implementing the connection module

- [ ] Unique constraint: one ETIMS **ComplianceConnection** per `sync2booksCompanyId` (or per `sync2booksConnectionId` if 1:1).
- [ ] `ComplianceTenant` upsert keyed by `sync2booksCompanyId`.
- [ ] Branch mapping entity or embedded map with validation rules.
- [ ] Mode A: internal service auth from main API → Compliance; no raw API key forwarding.
- [ ] Mode B: session-scoped access to same tenant rows.
- [ ] Provisioning job: idempotent, observable status on Sync2Books connection.
- [ ] Events: `etims.provisioned`, `etims.failed`, `etims.disconnected` for webhooks/monitoring.

---

## 9. Glossary

| Term | Meaning |
|------|---------|
| **Integrator (ETIMS)** | The Sync2Books **connection type** for KRA/OSCU compliance, analogous to other connectors. |
| **Provisioning** | Creating/linking **Compliance tenant + ComplianceConnection** after ETIMS is enabled on the main API. |
| **Correlation** | Stable ids (`sync2booksCompanyId`, `sync2booksConnectionId`) tying main API and Compliance rows together. |

---

## 10. Document maintenance

Update this file when:

- Main API route prefixes or connection model names change.
- You add multi-region Compliance or multiple OSCU profiles per company.
- Auth Mode A/B boundaries shift (e.g. BFF-only dashboard).
