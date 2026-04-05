# Compliance organization API — usage manual

This document explains how to provision **tenants (businesses)**, **branches**, and **eTIMS connections** in the Compliance API, including **device initialization** and how identifiers map to Sync2Books.

**Related:** [ETIMS_INTEGRATOR_PROVISIONING.md](./ETIMS_INTEGRATOR_PROVISIONING.md), [THREE_SERVICE_TRUST_AND_CONNECTION_ARCHITECTURE.md](./THREE_SERVICE_TRUST_AND_CONNECTION_ARCHITECTURE.md).

---

## 1. What this module does

The Compliance API stores **OSCU/eTIMS runtime data** per company and branch: KRA PIN, branch office id (`bhfId`), device serial, **CMC key**, and environment (sandbox vs production). Sync2Books **companies** and **branches** are correlated using stable external ids so the same business can be managed from the **developer API** (Sync2Books API) and the **Compliance dashboard** without duplicating OSCU state.

| Concept | In Compliance | Maps from Sync2Books |
|--------|----------------|----------------------|
| Tenant | `ComplianceTenant` | Optional `sync2booksCompanyId` when linked to the main Sync2Books API; omit for **compliance-dashboard-only** tenants |
| Branch | `ComplianceBranch` | Optional `sync2booksBranchId` (location key); omit when the branch exists only in Compliance |
| KRA office | `kraBhfId` on the branch | Must match KRA **bhfId** used in OSCU |
| eTIMS connection | One row per branch | Optional `sync2booksConnectionId` (integrator connection in main API) |

**Compliance dashboard (no main-app Sync2Books ids):** Create a tenant without `sync2booksCompanyId` and branches without `sync2booksBranchId`; use the returned **`id`** values on later calls. To update those rows, send the same **`id`** in the request body (`POST .../tenants` or `POST .../branches`) together with fields to change. `sync2booksConnectionId` on the eTIMS connection remains optional everywhere.

---

## 2. Naming: `dvcSrlNo` vs `deviceId`

OSCU uses two different device-related values:

| Field | Meaning |
|-------|--------|
| **`dvcSrlNo`** | Device **serial** you send in the **initialize** request body: `{ "tin", "bhfId", "dvcSrlNo" }`. |
| **`deviceId`** (stored) | OSCU **`dvcId`** returned in `data.info` after a successful initialize. Used as the device identifier on later eTIMS calls together with **CMC key**. |

Do not confuse them: **`dvcSrlNo`** is input for init; **`deviceId`** in our API is the post-init **dvcId**.

---

## 3. Base URL and discovery

- Controller base path: **`/compliance-organization`**
- Full paths are listed below. Interactive docs: **Swagger** when enabled (see `swagger` setup in the app).

All examples assume:

`https://<host>/compliance-organization`

Adjust the prefix if your deployment adds a global prefix (for example `/compliance/v1`).

**Automated e2e (local):** The API uses TypeORM **sql.js** (embedded file DB). Compliance flows are covered by `npm run test:e2e:compliance`, which creates a **temporary database file** under the OS temp directory (no Docker DB required). Full suite: `npm run test:e2e`.

---

## 4. End-to-end flow (recommended order)

### Step 1 — Upsert a tenant (business)

**`POST /compliance-organization/tenants`**  
**Status:** `201 Created`

Body:

```json
{
  "sync2booksCompanyId": "your-sync2books-company-uuid",
  "displayName": "Acme Ltd"
}
```

Omit `sync2booksCompanyId` when provisioning from the compliance dashboard only; the response still includes **`id`**. To change a dashboard-only tenant later, include **`id`** (internal tenant id) in the body.

- **`sync2booksCompanyId`**: when present, must match the Sync2Books **company** id for idempotent upsert with the main API; when omitted, a new tenant is created without that link.

Response includes **`id`** (internal Compliance tenant id). Use it for branch routes.

---

### Step 2 — Upsert a branch

**`POST /compliance-organization/tenants/:tenantId/branches`**  
**Status:** `201 Created`

Body:

```json
{
  "sync2booksBranchId": "your-sync2books-branch-or-location-id",
  "displayName": "Nairobi HQ",
  "kraBhfId": "00"
}
```

Omit `sync2booksBranchId` for dashboard-only branches, or send **`id`** (internal branch id) to update an existing branch.

- **`sync2booksBranchId`**: when present, stable id from Sync2Books (or your ERP) for idempotent upsert; when omitted, each request creates a new branch unless **`id`** is supplied.
- **`kraBhfId`**: KRA **branch id (bhfId)** for this office. **Required before ETIMS initialize** so the server can call OSCU with the correct `{ tin, bhfId, dvcSrlNo }`.

Response includes **`id`** (internal branch id). Use it for eTIMS connection routes.

---

### Step 3 — Create or update the eTIMS connection (shell)

**`PUT /compliance-organization/branches/:branchId/etims-connection`**

Body (minimal shell before initialize; placeholders allowed where noted):

```json
{
  "kraPin": "P012345678X",
  "deviceId": "pending",
  "cmcKey": "pending",
  "dvcSrlNo": "YOUR_DEVICE_SERIAL",
  "environment": "SANDBOX",
  "sync2booksConnectionId": "optional-main-api-etims-connection-id"
}
```

- **`kraPin`**: taxpayer PIN (**tin**).
- **`environment`**: `SANDBOX` or `PRODUCTION`.
- **`dvcSrlNo`**: optional here if you will pass it only in the initialize call.
- **`deviceId` / `cmcKey`**: you may use temporary strings until **initialize** completes; the initialize flow will overwrite **`deviceId`** with OSCU **`dvcId`** and **`cmcKey`** from `data.info`.
- **`sync2booksConnectionId`**: optional link to the ETIMS row in the **main Sync2Books API** (integration catalog).

---

### Step 4 — Initialize ETIMS (OSCU initialize)

**`POST /compliance-organization/branches/:branchId/etims-connection/initialize`**  
**Status:** `200 OK`

This calls the OSCU **initialize** operation with body:

`{ "tin": <kraPin>, "bhfId": <branch.kraBhfId>, "dvcSrlNo": <serial> }`

and persists **`cmcKey`** and **`dvcId`** from **`data.info`**.

Body (optional field):

```json
{
  "dvcSrlNo": "YOUR_DEVICE_SERIAL"
}
```

- If **`dvcSrlNo`** is omitted, the value stored on the connection from Step 3 is used.
- If neither the body nor the connection has **`dvcSrlNo`**, the request fails with a **400** validation-style error.

**Prerequisites checked by the server:**

1. Branch exists.
2. **`kraBhfId`** is set on the branch.
3. An eTIMS connection row exists for the branch (Step 3).

**Success:** response body reflects the updated **compliance connection** (including new **`cmcKey`**, **`deviceId`** = OSCU **`dvcId`**, and **`dvcSrlNo`**).

---

## 5. Other read/list endpoints

| Method | Path | Purpose |
|--------|------|--------|
| `GET` | `/tenants/by-sync2books/:sync2booksCompanyId` | Resolve tenant by company id |
| `GET` | `/tenants/:tenantId` | Get tenant by internal id |
| `GET` | `/tenants/:tenantId/branches` | List branches |

---

## 6. Runtime behavior (adapter mode)

- **`NODE_ENV=test`** (typical unit/e2e): the **stub** eTIMS adapter is used; initialize returns synthetic **`data.info`** (no real KRA call).
- **Real sandbox/production HTTP**: configure **`ETIMS_ADAPTER_MODE=http`** and OSCU/Apigee environment variables as described in `EtimsModule` / deployment docs. Initialize then hits the real gateway; ensure **Apigee** and **CMC** header rules match your environment (some gateways expect **`cmcKey`** on headers even for initialize; empty string may be required until the first successful init).

---

## 7. Common errors

| Symptom | Likely cause |
|--------|----------------|
| `404` on tenant | Wrong `sync2booksCompanyId` or tenant not created |
| `404` on branch | Wrong internal `branchId` |
| `400` “kraBhfId is required” | Branch missing **KRA bhfId** — update branch with `PUT`-equivalent upsert including **`kraBhfId`** |
| `400` “Create an eTIMS connection first” | No row from **PUT** `.../etims-connection` |
| `400` “dvcSrlNo is required” | Pass **`dvcSrlNo`** in initialize body or on the connection |
| `400` initialize / OSCU error | Invalid tin/bhfId/serial, wrong environment, or gateway auth (Apigee) |

---

## 8. Security and operations

- Treat **`cmcKey`**, device identifiers, and **PINs** as secrets. Do not log request bodies in production.
- Prefer storing long-lived OSCU secrets only in **Compliance** and referencing **`sync2booksConnectionId`** from the main API, as described in [ETIMS_INTEGRATOR_PROVISIONING.md](./ETIMS_INTEGRATOR_PROVISIONING.md).
- Retry initialize after fixing validation errors; design your UI or worker to be **idempotent** where possible (same branch, updated serial).

---

## 9. Quick reference (curl)

Replace placeholders and base URL.

```bash
# 1) Tenant
curl -sS -X POST "$BASE/compliance-organization/tenants" \
  -H "Content-Type: application/json" \
  -d '{"sync2booksCompanyId":"company-1","displayName":"Demo"}'

# 2) Branch (use tenant id from response as TENANT_ID)
curl -sS -X POST "$BASE/compliance-organization/tenants/TENANT_ID/branches" \
  -H "Content-Type: application/json" \
  -d '{"sync2booksBranchId":"branch-1","kraBhfId":"00","displayName":"HQ"}'

# 3) Connection shell (use branch id as BRANCH_ID)
curl -sS -X PUT "$BASE/compliance-organization/branches/BRANCH_ID/etims-connection" \
  -H "Content-Type: application/json" \
  -d '{"kraPin":"P012345678X","deviceId":"pending","cmcKey":"pending","environment":"SANDBOX","dvcSrlNo":"SERIAL123"}'

# 4) Initialize
curl -sS -X POST "$BASE/compliance-organization/branches/BRANCH_ID/etims-connection/initialize" \
  -H "Content-Type: application/json" \
  -d '{"dvcSrlNo":"SERIAL123"}'
```

---

*Document version: aligned with Compliance API compliance-organization module (tenants, branches, ETIMS connection, initialize).*
