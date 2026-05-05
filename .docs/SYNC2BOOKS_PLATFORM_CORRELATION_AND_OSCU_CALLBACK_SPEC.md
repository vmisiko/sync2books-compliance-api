# Sync2Books platform correlation & OSCU callback — design spec (pre-implementation)

**Audience:** Compliance + Main API (`api/`) engineers.  
**Goal:** Define how Compliance **captures** `x-sync2books-sync-item-id` / `x-sync2books-sync-batch-id` (and related headers), **persists** them against the right domain record(s), and **when** to call the Main API’s **internal webhook** so `sync_items` can reflect **late or final** OSCU/compliance outcomes.

**Note:** Completing sync status on the **Main API** updates **`sync_items`** (ETIMS / Compliance path). This is **not** QuickBooks; QB is a separate integration.

---

## 1. Current reality in this repo (ground truth)

### 1.1 Sales & express credit notes (`/api/sales`, `/api/sales/credit-notes/express`)

- `ApiSalesController` builds a **`ComplianceDocument`**, then (when `submit !== 'false'`) runs **validate → prepare → `submitDocument`** in the **same HTTP request**.
- **`submitDocument`** (`submit-document.usecase.ts`) calls **`etimsAdapter.submitInvoice`** (OSCU), then transitions **`SUBMITTED` → `ACCEPTED` | `REJECTED` | `RETRYING`** and appends **`ComplianceEvent`** (`ACCEPTED` / `REJECTED`).
- So today the OSCU outcome is usually **available before the HTTP response returns**. A “callback” still matters when you move submission to **background workers** (`enqueueProcessing` / queues) or when KRA/OSCU introduces delayed finalization beyond the adapter’s single round-trip.

**Callback hooks (conceptual):** fire when the document reaches a **terminal or user-visible submission outcome** — at minimum **`ACCEPTED`** and **`REJECTED`** (and optionally **`RETRYING`** if the platform wants retries surfaced immediately).

### 1.2 Catalog — register item (`POST /catalog/items`)

- **`registerItem`** persists/updates a **`CatalogItem`** and sets **`registrationStatus: 'PENDING'`** when classification changes — it does **not** call OSCU.
- OSCU **`saveItem`** runs in **`syncItemsToEtims`** (`POST /catalog/items/sync`).

**Implication:** A Sync2Books **`sync_item`** for **catalog register** usually means **“Compliance DB row ready / pending ETIMS sync”**, not **“OSCU accepted the item”**. Do not conflate the two in callback payloads.

### 1.3 Catalog — sync to ETIMS (`POST /catalog/items/sync`)

- **`syncItemsToEtims`** loops **many** catalog rows and calls **`etimsAdapter.saveItem`** per item.
- **One** Main API HTTP call (one **`sync_item.id`**) can therefore map to **N OSCU attempts**.

**Implication:** The platform cannot assume **1 sync_item : 1 OSCU result** for this route unless the product changes (e.g. Main API enqueues **one sync item per catalog item**).

---

## 2. Inbound headers (from Main API — already sent for ETIMS sync handler)

| Header | Meaning |
|--------|---------|
| `x-sync2books-company-id` | Merchant/company (required by `ComplianceServiceAuthGuard` today). |
| `x-sync2books-application-id` | App scope. |
| `x-sync2books-connection-id` | Platform ETIMS connection id. |
| `x-sync2books-sync-batch-id` | `sync_batches.id` on Main API. |
| `x-sync2books-sync-item-id` | **`sync_items.id`** — **primary key** Main API will use to PATCH late status. |
| `x-request-id` | Same as `sync_item.id` today (tracing). |
| `x-idempotency-key` | Same as `sync_item.id` today (dedup). |

**Compliance work:** read these on **integration** routes (`ComplianceServiceAuthGuard` paths), not only in the guard — e.g. Nest decorator + `AsyncLocalStorage` or explicit `req.platformContext` set by thin middleware after auth.

---

## 3. Recommended Compliance storage (single pattern for all flows)

Introduce a dedicated persistence concept so you do not overload `ComplianceDocument` / `CatalogItem` for every edge case:

### 3.1 Table: `platform_outbound_link` (name TBD)

One row per **Sync2Books-initiated HTTP invocation** that should be traceable end-to-end.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Compliance primary key. |
| `sync_item_id` | string (UUID) | From `x-sync2books-sync-item-id` — **required** when header present. |
| `sync_batch_id` | string (UUID) | From `x-sync2books-sync-batch-id`. |
| `application_id` | string?, nullable | From `x-sync2books-application-id`. |
| `connection_id` | string?, nullable | From `x-sync2books-connection-id`. |
| `company_id` | string | From `x-sync2books-company-id` (duplicate for query convenience). |
| `channel` | enum | `SALES_DOCUMENT` \| `CATALOG_REGISTER` \| `CATALOG_SYNC_BATCH` \| `STOCK_TRANSFER` \| `STOCK_ADJUST` \| `OTHER`. |
| `compliance_subject_type` | enum | `DOCUMENT` \| `CATALOG_ITEM` \| `STOCK_MOVEMENT` \| `NONE`. |
| `compliance_subject_id` | string?, nullable | `ComplianceDocument.id`, or synthetic id for batch operations. |
| `callback_state` | enum | `PENDING` \| `SENT` \| `FAILED` \| `SKIPPED` (e.g. no OSCU for register). |
| `last_callback_at` | timestamp?, nullable | |
| `last_oscu_phase` | string?, nullable | e.g. `NONE`, `SAVE_ITEM`, `SUBMIT_SALES`, `FINAL`. |
| `aggregate_status` | enum?, nullable | For multi-item catalog sync: `SUCCESS` \| `FAILED` \| `PARTIAL`. |
| `created_at` / `updated_at` | timestamps | |

**Optional child table** `platform_outbound_link_item` for **catalog sync** N-for-1:

| Column | Description |
|--------|-------------|
| `link_id` | FK → `platform_outbound_link.id` |
| `catalog_item_id` | Compliance catalog item id |
| `success` | bool |
| `result_cd` / `result_msg` | From OSCU |
| `raw_snapshot` | JSON optional |

**Denormalization (optional, for convenience):** copy `sync_item_id` / `sync_batch_id` onto **`compliance_documents`** when `channel = SALES_DOCUMENT` so dashboards can join without the link table — but the **link table** should remain the **source of truth** for callbacks.

### 3.2 When to create the row

- **At the HTTP boundary** of each integration controller method that Main API calls with sync headers: after auth, if `x-sync2books-sync-item-id` is present, **upsert or insert** `platform_outbound_link` and pass **`linkId`** (or the context object) into application services / use cases.

---

## 4. Examples (by product flow)

### 4.1 Sale (`POST /api/sales`) or credit note (`POST` / express credit)

1. Controller reads platform context from headers.
2. Create **`platform_outbound_link`** with `channel = SALES_DOCUMENT`, `compliance_subject_type = DOCUMENT`, `compliance_subject_id` empty until document exists.
3. **`createDocument`** → receive **`documentId`** → **update link** `compliance_subject_id = documentId`.
4. **`submitDocument`** completes (sync today; async tomorrow):
   - On **`ACCEPTED`** / **`REJECTED`** / **`RETRYING`** (policy choice), enqueue **callback job** with payload (§6).
5. **`callback_state`**: `SENT` after Main API returns 2xx.

**Correlation key in callback:** always **`sync_item_id`** + **`documentId`** (+ receipt / error envelope).

### 4.2 Catalog register (`POST /catalog/items`)

1. Create link: `channel = CATALOG_REGISTER`, `compliance_subject_type = CATALOG_ITEM`, **`last_oscu_phase = NONE`**.
2. After **`registerItem`**, set `compliance_subject_id = catalogItem.id`.
3. **Callback policy (choose one explicitly):**
   - **A — No OSCU callback:** mark `callback_state = SKIPPED` or send **one “persisted”** callback with `osculPhase: NONE`, `aggregateStatus: SUCCESS` meaning “Compliance accepted the payload and stored the item”; Main API may keep `sync_item` **synced** with `integrationResponse` describing PENDING ETIMS.
   - **B — Defer until first OSCU:** do not send platform callback on register; only send when a later **`/catalog/items/sync`** run includes that item **and** Main API uses a **new** `sync_item` for that sync — different id, so register’s `sync_item` would never get OSCU final — **avoid** unless product is clear.

**Recommendation:** **A** for register: one honest callback = **“catalog row ready, ETIMS sync still pending”** if you need webhook symmetry; otherwise skip callback and rely on Main API HTTP response for register.

### 4.3 Catalog sync (`POST /catalog/items/sync`)

1. Create **one** `platform_outbound_link` per HTTP request (one `sync_item_id`).
2. `channel = CATALOG_SYNC_BATCH`, `compliance_subject_id` = optional batch id or null.
3. For each `saveItem` result, insert **`platform_outbound_link_item`** rows.
4. After loop: set **`aggregate_status`** = `SUCCESS` / `FAILED` / `PARTIAL`.
5. **Single callback** to Main API with **array of per-item results** + aggregate (§6).

### 4.4 Stock transfer / adjust

Mirror **sales** if there is a single persisted “movement” aggregate with a clear terminal state; otherwise same pattern as **catalog sync** if one request fans out to multiple OSCU calls.

---

## 5. When to invoke the Main API internal webhook

| Trigger | Typical use |
|---------|-------------|
| **Document terminal outcome** | `ACCEPTED`, `REJECTED` (and optionally `RETRYING`) after `submitDocument` (or async worker equivalent). |
| **Catalog sync batch finished** | After all `saveItem` attempts in that HTTP handler (or job) complete. |
| **Catalog register** | Only if you adopt policy **A** (§4.2); fire once after DB save. |
| **Retry / reconciliation** | Same events re-fired with same `sync_item_id` must be **idempotent** on Main API (§7). |

**Do not** block OSCU on HTTP callback success; use **outbox pattern**: persist event → async POST → retry with backoff; update `callback_state`.

---

## 6. Main API callback — payload contract (implemented on `api/`)

`POST {MAIN_API_BASE_URL}/internal/compliance/oscu-outcome`  
**Auth:** `Authorization: Bearer <COMPLIANCE_CALLBACK_TOKEN>` (Main API env). **`x-sync2books-company-id`** header must equal JSON **`companyId`**. Same token can differ from Main→Compliance `COMPLIANCE_SERVICE_TOKEN` — use one shared secret in dev if preferred.

Nest DTO (reference): `api/src/compliance/dto/compliance-oscu-outcome.dto.ts`.

```json
{
  "syncItemId": "uuid",
  "syncBatchId": "uuid",
  "applicationId": "uuid",
  "connectionId": "uuid",
  "companyId": "uuid",
  "channel": "SALES_DOCUMENT",
  "complianceDocumentId": "uuid",
  "aggregateStatus": "SUCCESS",
  "complianceStatus": "ACCEPTED",
  "osculPhase": "SUBMIT_SALES",
  "receiptNumber": "string-or-null",
  "error": "string-or-null",
  "raw": {},
  "catalogItemResults": null
}
```

For **catalog sync**, set `channel: "CATALOG_SYNC_BATCH"`, `aggregateStatus: "PARTIAL"`, and:

```json
"catalogItemResults": [
  { "catalogItemId": "item-...", "success": true, "resultCd": "000", "resultMsg": "OK" }
]
```

**Idempotency:** include `eventId` (UUID) per callback emit; Main API stores last applied `eventId` per `syncItemId` or uses monotonic `sequence`.

---

## 7. Main API receiver (behavioral contract)

1. Authenticate Compliance.
2. Load **`sync_items`** by **`syncItemId`**; verify **`companyId` / `applicationId`** match the batch/item if needed.
3. Merge into **`integrationResponse`** JSON (or dedicated `compliance_async` JSON column later).
4. Optionally flip **`sync_item.status`** — product decision:
   - **Strict:** HTTP to Compliance succeeded → keep `synced`; async **failure** moves to **`failed`** and sets message.
   - **Soft:** introduce **`partial`** or flags inside JSON only.

---

## 8. Implementation phasing

| Phase | Compliance | Main API |
|-------|------------|----------|
| **P0** | Parse & persist headers into **`platform_outbound_links`** (table + global `PlatformOutboundCorrelationInterceptor` after M2M auth); attach `documentId` / catalog ids after use cases run (still TODO—link row stores HTTP context only today). | ✅ **`POST /internal/compliance/oscu-outcome`** + idempotent apply (`integrationResponse` merge, `eventId`). |
| **P1** | Outbox + worker to POST callback on **ACCEPTED/REJECTED** (sales) and **catalog sync** completion. | Optional customer-facing webhook when `sync_item` changes from async. |
| **P2** | Make sales pipeline **async** (`enqueueProcessing` default true) — callbacks become **required** for timely UI. | Dashboard polling already works off `sync_items`. |

---

## 9. Related docs

- Main API: `api/.docs/ETIMS_SYNC_PATTERN2_ORCHESTRATION.md` (correlation headers).
- `compliance-api/.docs/MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md` (Mode A headers).
- `compliance-api/.docs/THREE_SERVICE_TRUST_AND_CONNECTION_ARCHITECTURE.md` (Compliance → Main API webhooks).
