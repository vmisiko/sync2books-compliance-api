# Sync2Books ↔ Compliance Engine: Inter-Service SLA & Communication Spec

**Purpose:** Define SLAs, communication patterns, and integration boundaries between the **Sync2Books API** (main platform) and the **Compliance Engine** microservice *before* implementation.

---

## 1. Overview: Two Modes of Operation

The Compliance Engine is designed to operate in **two distinct modes**:

| Mode | Description | Who uses it |
|------|-------------|-------------|
| **Embedded (via Sync2Books)** | Compliance is one of the "connections" in the Sync2Books Integrations dashboard. Users joining Sync2Books can add Compliance alongside QuickBooks, Xero, etc. | Users on the Sync2Books platform |
| **Standalone** | Compliance runs independently with its own organisations, customers, branches (multi-tenant). No dependency on Sync2Books. | Direct Compliance customers |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        COMPLIANCE ENGINE (Microservice)                       │
│                                                                               │
│  ┌───────────────────────┐    ┌───────────────────────────────────────────┐ │
│  │  STANDALONE MODE      │    │  EMBEDDED MODE (via Sync2Books)             │ │
│  │  - Own orgs/customers │    │  - Linked via Sync2Books connection         │ │
│  │  - Own branches       │    │  - Uses ERP data from Sync2Books flows      │ │
│  │  - Direct API access  │    │  - Unified Integrations UI                  │ │
│  └───────────────────────┘    └───────────────────────────────────────────┘ │
│                                                                               │
│  Shared: Compliance Core, OSCU Adapter, Mapping Engine, Validation            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Integration Categories (Unified Integrations Dashboard)

The Sync2Books Integrations UI presents **two categories** of integrations:

| Category | Examples | Purpose |
|----------|----------|---------|
| **ERP / Accounting** | QuickBooks, Xero, Sage | Connect accounting systems for sync (invoices, customers, items) |
| **Compliance** | eTIMS (OSCU) | Regulatory compliance (documents, items, stock to KRA) |

Both appear in the **same dashboard** for connection management. The Compliance dashboard (future) will **use** ERP integrations as **data sources** for compliance workflows.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Sync2Books Integrations Dashboard (Unified)                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ACCOUNTING                                                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                            │
│  │ QuickBooks  │ │ Xero        │ │ Sage        │ ...                         │
│  └─────────────┘ └─────────────┘ └─────────────┘                            │
│                                                                               │
│  COMPLIANCE                                                                   │
│  ┌─────────────────────────────┐                                             │
│  │ eTIMS (OSCU) - Kenya        │  ← Compliance Engine as a "connection"      │
│  └─────────────────────────────┘                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Future: Compliance Dashboard                                                │
│  Uses ERP integrations (QuickBooks, etc.) as data sources                    │
│  Orchestrates: Invoice → Compliance → OSCU                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Identity & Tenant Mapping

### 3.1 Sync2Books → Compliance (Embedded Mode)

| Sync2Books | Compliance Engine |
|------------|-------------------|
| `applicationId` | `tenantId` or `applicationId` (passthrough) |
| `companyId` | `merchantId` (organisation in Compliance) |
| `connectionId` (ERP) | Reference for data source |
| `connectionId` (Compliance) | `ComplianceConnection` (merchantId + branchId + bhfId, etc.) |
| Branch (from ERP) | `branchId` / `bhfId` in Compliance |

Compliance does **not** create its own users/orgs when embedded. It receives **context** from Sync2Books:
- Who is calling (application, company)
- Which branch/ERP connection this relates to

### 3.2 Standalone Mode

- Compliance has its own `Organisation` (tenant)
- Each org has `Customers` and `Branches`
- Auth: Compliance's own JWT / API keys
- No Sync2Books `applicationId` or `companyId`

---

## 4. Communication Patterns

### 4.1 Sync2Books → Compliance (Embedded)

| Operation | Pattern | Direction |
|-----------|---------|-----------|
| Submit document | **Sync HTTP** | S2B API → Compliance API |
| Sync item | **Sync HTTP** | S2B API → Compliance API |
| Record stock movement | **Sync HTTP** | S2B API → Compliance API |
| List documents / status | **Sync HTTP** | S2B API → Compliance API |
| Webhook / event-driven flow | **Async (optional)** | S2B → Event Bus → Compliance |

**Recommended:** Start with **sync HTTP** for all control-plane operations. Event-driven can be added later for higher throughput.

### 4.2 Compliance → Sync2Books (Embedded)

| Operation | Pattern | Direction |
|-----------|---------|-----------|
| Push ETR receipt to QuickBooks | **Sync HTTP** | Compliance → S2B API (internal) |
| Fetch ERP entity for mapping | **Sync HTTP** | Compliance → S2B API |
| Notify submission result | **Webhook (optional)** | Compliance → S2B webhook URL |

### 4.3 Standalone

- All traffic is **direct to Compliance API**
- No Sync2Books involvement

---

## 5. API Contract Boundaries

### 5.1 Compliance API (as consumed by Sync2Books)

Base URL (configurable): `https://compliance.sync2books.com` or `https://api.sync2books.com/compliance/v1`

| Header | Purpose |
|--------|---------|
| `Authorization: Bearer <token>` | JWT (issued by Sync2Books or Compliance) |
| `x-application-id` | Sync2Books application (optional in embedded) |
| `x-company-id` | Sync2Books company (maps to merchantId) |
| `x-connection-id` | Sync2Books connection (Compliance connection) |
| `x-idempotency-key` | Idempotent submission |

### 5.2 Sync2Books API (as consumed by Compliance)

When Compliance needs to fetch ERP data or push ETR receipts:

| Endpoint (conceptual) | Purpose |
|----------------------|---------|
| `GET /companies/:companyId/connections/:connectionId/...` | Resolve connection / ERP context |
| `POST /sync/...` or internal service | Push ETR receipt to QuickBooks invoice |
| `GET /invoices/:id` | Fetch invoice for mapping (if needed) |

---

## 6. SLA (Service Level Agreements)

### 6.1 Availability & Uptime

| Metric | Target | Notes |
|--------|--------|-------|
| Compliance API uptime | 99.5% | Excludes scheduled maintenance |
| Sync2Books API uptime | 99.5% | Same as platform |
| Cross-service latency (p95) | < 500 ms | For sync HTTP calls |

### 6.2 Document Submission SLA

| Phase | Target | Notes |
|-------|--------|-------|
| Validate document | < 200 ms | Pre-submission validation |
| Submit to OSCU | < 5 s | Depends on KRA/OSCU; Compliance controls retries |
| End-to-end (S2B → Compliance → OSCU) | < 10 s (best effort) | Excluding OSCU downtime |

### 6.3 Retry & Resilience

| Scenario | Behaviour |
|----------|-----------|
| Compliance API 5xx / timeout | Sync2Books retries: 3 attempts, exponential backoff (1s, 2s, 4s) |
| OSCU 5xx / timeout | Compliance retries per `08-retry-queue-and-idempotency-spec.md` |
| Validation failure (4xx) | No retry; return error to caller |
| Idempotency | Use `x-idempotency-key`; duplicate requests return cached result |

### 6.4 Data Consistency

| Rule | Description |
|------|-------------|
| At-least-once submission | Idempotency ensures no double-submission to OSCU |
| Document immutability | Once SUBMITTED, document is immutable |
| Stock movements | Atomic; no partial updates |

---

## 7. Authentication & Authorization

### 7.1 Embedded Mode (Sync2Books → Compliance)

**Option A: Service-to-Service (recommended)**  
- Sync2Books holds a **service API key** or **JWT** for Compliance  
- Each request includes `x-application-id`, `x-company-id`, `x-connection-id`  
- Compliance validates: token valid + company has compliance connection

**Option B: User Token Passthrough**  
- Sync2Books forwards the user's JWT to Compliance  
- Compliance validates JWT (shared secret or JWKS) and extracts company/application

### 7.2 Standalone Mode

- Compliance's own auth (JWT, API keys)
- No Sync2Books context headers

---

## 8. Error Handling & Observability

### 8.1 Error Codes (Compliance → Sync2Books)

| Code | Meaning |
|------|---------|
| 400 | Validation failed (business rules) |
| 401 | Unauthorized |
| 404 | Document / branch / item not found |
| 409 | Conflict (e.g. duplicate submission) |
| 422 | Mapping missing, item not registered |
| 429 | Rate limited |
| 502/503 | Compliance or upstream (OSCU) temporary failure |

### 8.2 Correlation & Tracing

| Header | Purpose |
|--------|---------|
| `x-request-id` | End-to-end trace (Sync2Books → Compliance → OSCU) |
| `x-correlation-id` | Business correlation (e.g. batch id, sync batch id) |

### 8.3 Logging

- Compliance logs: request id, merchantId, branchId, documentId, status, latency
- Sync2Books logs: request id, companyId, connectionId, compliance response

---

## 9. Data Flow Summary (Embedded Mode)

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  QuickBooks (ERP)   │     │  Sync2Books API     │     │  Compliance Engine  │
└──────────┬──────────┘     └──────────┬──────────┘     └──────────┬──────────┘
           │                          │                            │
           │ 1. Invoice created       │                            │
           │    (webhook)             │                            │
           └─────────────────────────►│                            │
           │                          │ 2. Normalise + Map         │
           │                          │    (ERP → canonical)       │
           │                          │                            │
           │                          │ 3. POST /documents         │
           │                          │    (with idempotency-key)  │
           │                          └───────────────────────────►│
           │                          │                            │
           │                          │                    4. Validate
           │                          │                    5. Submit to OSCU
           │                          │                            │
           │                          │ 6. 201 + oscuReceiptNumber  │
           │                          │◄───────────────────────────┘
           │                          │
           │ 7. Sync ETR receipt      │
           │    (attachment)          │
           │◄─────────────────────────┘
           │
```

---

## 10. Compliance Connection Lifecycle (Embedded)

1. **Enable** – Application enables Compliance integration in catalog (like QuickBooks).
2. **Connect** – User connects Compliance: provides TIN, bhfId, branch, communication key (from KRA OSCU approval).
3. **Store** – Sync2Books stores `ComplianceConnection` (or references it); credentials may live in Compliance for security.
4. **Use** – When invoices/items flow from ERP, Sync2Books calls Compliance with connection context.
5. **Disconnect** – User disconnects; no further submissions. Historical data retained per retention policy.

---

## 11. Out-of-Scope (Deferred)

- Compliance-specific UI (separate dashboard) – later phase
- Multi-country compliance (beyond Kenya/OSCU) – extensible but not in initial SLA
- Real-time webhooks from Compliance to Sync2Books – optional enhancement

---

## 12. Sequence Diagrams

### 12.1 Document Submission (Embedded Mode)

```
User/System          Sync2Books API         Compliance API         OSCU (KRA)
     │                      │                      │                    │
     │  Invoice event        │                      │                    │
     │─────────────────────►│                      │                    │
     │                      │  POST /documents     │                    │
     │                      │  x-idempotency-key   │                    │
     │                      │─────────────────────►│                    │
     │                      │                      │  Submit invoice    │
     │                      │                      │───────────────────►│
     │                      │                      │                    │
     │                      │                      │  Receipt + ETR    │
     │                      │                      │◄───────────────────│
     │                      │  201 + oscuReceipt   │                    │
     │                      │◄────────────────────│                    │
     │                      │                      │                    │
     │                      │  Push ETR to QB      │                    │
     │                      │  (internal)          │                    │
     │                      │─────────────────────►│                    │
     │  ETR attached        │                      │                    │
     │◄─────────────────────│                      │                    │
```

### 12.2 Connection Setup (User adds Compliance in Integrations)

```
User             Sync2Books UI      Sync2Books API       Compliance API
  │                    │                    │                    │
  │  Click "Connect    │                    │                    │
  │  eTIMS"           │                    │                    │
  │───────────────────►│                    │                    │
  │                    │  GET /compliance/  │                    │
  │                    │  connection/form   │                    │
  │                    │──────────────────►│                    │
  │                    │                    │  (form: TIN,      │
  │                    │                    │   bhfId, commKey)  │
  │                    │◄───────────────────│                    │
  │  Form: TIN, bhfId  │                    │                    │
  │  comm key          │                    │                    │
  │───────────────────►│                    │                    │
  │                    │  POST /compliance/ │                    │
  │                    │  connections       │                    │
  │                    │  (store or relay)  │                    │
  │                    │───────────────────────────────────────►│
  │                    │                    │  201 Created       │
  │                    │◄───────────────────────────────────────│
  │  Connected         │                    │                    │
  │◄───────────────────│                    │                    │
```

---

## 13. Summary: Pre-Implementation Checklist

- [ ] Confirm Compliance API base URL and env (dev/staging/prod)
- [ ] Define service-to-service auth (API key vs JWT)
- [ ] Add `compliance` or `etims` to IntegrationKeyType / IntegrationCatalog
- [ ] Implement Compliance "connection" flow in Sync2Books (credentials: TIN, bhfId, comm key)
- [ ] Implement Sync2Books → Compliance HTTP client with retry + idempotency
- [ ] Implement Compliance → Sync2Books ETR receipt sync (internal API or service call)
- [ ] Set up correlation headers (x-request-id, x-correlation-id)
- [ ] Document error codes and SLAs for consumers

---

*Document version: 1.0 | Last updated: 2025-02-14*
