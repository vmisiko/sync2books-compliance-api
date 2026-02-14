# Personas, Data Source Architecture & Platform Contract

**Purpose:** Define the three personas, clarify how Compliance uses Sync2Books ERP APIs as its data source, and establish the contract that enables reuse without tight coupling.

---

## 1. Core Principle: Single Data Source, Shared Architecture

**Sync2Books is the canonical ERP data layer.** Compliance does not build its own QB/Xero connections. It consumes Sync2Books APIs like any other application.

```
                    ┌─────────────────────────────────────────────────────────┐
                    │              Sync2Books Platform                         │
                    │  • Applications, API Keys, Companies, Connections         │
                    │  • ERP OAuth (QB, Xero, Sage) via Link                   │
                    │  • Webhooks, Sync, Normalised Data APIs                  │
                    └──────────────────────────┬───────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
         ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
         │ Developer's App  │    │ Compliance Engine │    │ Other Apps        │
         │ (external)        │    │ (microservice)    │    │ (future)          │
         │                  │    │                  │    │                    │
         │ • API key        │    │ • API key or     │    │ • Same pattern    │
         │ • connections    │    │   service auth   │    │                    │
         │ • ERP + Compliance│   │ • ERP as input  │    │                    │
         │   via S2B APIs   │    │ • OSCU as output│    │                    │
         └──────────────────┘    └──────────────────┘    └──────────────────┘
```

**Result:** No double work. One ERP connection infra. Compliance and Developers both use it.

---

## 2. The Three Personas

### Persona 1: CFO / Compliance User (Standalone)

| Attribute | Description |
|-----------|-------------|
| **Who** | CFO, finance lead, compliance officer |
| **Goal** | Stay compliant with eTIMS; submit sales, invoices, credit notes to KRA |
| **Context** | Uses **Compliance standalone UI** – not the developer dashboard |
| **Tech level** | Low; prefers UI, not APIs |

**Flow:**
1. Signs up on **Compliance app** (compliance.sync2books.com or app.compliance.io)
2. Creates organisation, branches
3. **Connects accounting system** (QB, Xero) as data source:
   - Compliance UI embeds **Sync2Books Link** (or equivalent connect flow)
   - User completes OAuth with QuickBooks/Xero
   - Connection is stored in Sync2Books; Compliance stores the `connectionId` reference
4. Invoices/sales flow: QB → Sync2Books → Compliance fetches via Sync2Books APIs → submits to OSCU
5. Views compliance dashboard: document status, ETR receipts, reconciliation

**Key point:** The CFO never sees the Sync2Books developer dashboard. They only see Compliance UI. Behind the scenes, Compliance uses Sync2Books for ERP connectivity.

---

### Persona 2: Developer (API-First, eTIMS via Simplified APIs)

| Attribute | Description |
|-----------|-------------|
| **Who** | Developer building an app that needs eTIMS compliance |
| **Goal** | Integrate to eTIMS through **simplified** APIs; avoid raw OSCU complexity |
| **Context** | Uses **Sync2Books developer dashboard** – API keys, connections, webhooks |
| **Tech level** | High; comfortable with APIs, webhooks, SDKs |

**Flow:**
1. Signs up on **Sync2Books** (app.sync2books.com)
2. Creates **Application**, gets **API key**
3. Connects customers' QB/Xero via Link → gets `connectionId`
4. **Enables Compliance** as an integration (like enabling QuickBooks)
5. Data flow options:
   - **Push:** Developer's app sends invoices to Sync2Books → Sync2Books pushes to Compliance
   - **Pull:** Compliance subscribes to Sync2Books webhooks; when invoice syncs, Compliance fetches and submits to OSCU
   - **Direct:** Developer calls Compliance API with `connectionId`; Compliance fetches invoice from Sync2Books and submits
6. Developer uses dashboard for: API keys, connection status, webhook config, sync monitoring, compliance status

**Key point:** Developer uses the same Sync2Books architecture for ERP and Compliance. One dashboard, one set of connections. Compliance APIs are an extension of Sync2Books.

---

### Persona 3: Platform Builder / ISV (Embedding Compliance in Product)

| Attribute | Description |
|-----------|-------------|
| **Who** | ISV or platform (e.g. POS, inventory, billing) embedding Sync2Books + Compliance |
| **Goal** | Offer customers ERP sync + eTIMS in one product |
| **Context** | Same as Developer; often also white-label or co-branded |
| **Tech level** | High |

**Flow:** Same as Developer. Uses API key, connections, webhooks. Can white-label the Link, use same APIs. Compliance is just another capability in the Sync2Books ecosystem.

---

## 3. Data Source Contract: Compliance ↔ Sync2Books

Compliance treats Sync2Books as its **ERP data source**. The contract is the Sync2Books public API.

### 3.1 Sync2Books Exposes (Data Source APIs)

| Resource | Endpoint (conceptual) | Used by Compliance for |
|----------|------------------------|------------------------|
| Invoices | `GET /companies/:companyId/invoices` or equivalent | Document submission to OSCU |
| Customers | `GET /companies/:companyId/customers` or `.../connections/:connectionId/customers` | Invoice customer/PIN mapping |
| Items | `GET /companies/:companyId/items` or by connection | Item registration, line mapping |
| Connection metadata | `GET /companies/:companyId/connections` | Branch, connection status |
| Attachment push | `POST /attachments` or similar | ETR receipt → QuickBooks invoice |

**Authentication:** Compliance uses an **API key** (or service token) scoped to an Application. The Application can be:
- **Sync2Books-owned** (for embedded/standalone Compliance users)
- **Developer-owned** (when Developer enables Compliance for their app)

### 3.2 Compliance Exposes (Compliance APIs)

| Resource | Used by | Purpose |
|----------|---------|---------|
| `POST /documents` | Sync2Books, Developer app | Submit document for eTIMS |
| `GET /documents` | Sync2Books, Developer app | List document status |
| `POST /items` | Sync2Books | Register/sync items |
| `POST /inventory/movements` | Sync2Books | Stock movements |
| `POST /reconciliation/run` | Sync2Books, Compliance UI | Trigger reconciliation |

**Authentication:** API key (from Sync2Books or Compliance) or JWT.

---

## 4. Merging the Two UIs Without Tight Coupling

### 4.1 The Challenge

- **Developer dashboard:** API keys, connectionIds, webhooks, sync batches – technical, developer-focused
- **Compliance:** Document status, ETR receipts, reconciliation – compliance/business-focused
- **Goal:** Reuse the same architecture for both; avoid duplicate connection/ERP logic

### 4.2 Strategy: Same Backend, Two Frontends

| Layer | Shared | Separate |
|-------|--------|----------|
| **Backend** | Sync2Books API, Compliance API, Connections, Link | — |
| **Developer UI** | Full dashboard: integrations (ERP + Compliance), API keys, webhooks, connections | Developer-specific: API docs, webhook logs, sync debug |
| **Compliance UI** | Uses Link for QB/Xero connect; uses Sync2Books APIs under the hood | CFO-specific: document list, ETR view, reconciliation |

**Coupling rule:** Both UIs call the same APIs. No UI-to-UI dependency. Compliance UI does not import Developer dashboard components; it may reuse shared primitives (Link, design system) only.

### 4.3 Where the "Merge" Happens (Developer Dashboard)

For **Developers**, the Integrations dashboard shows:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Integrations                                    [Developer View]   │
├─────────────────────────────────────────────────────────────────────┤
│  ACCOUNTING (data sources)                                           │
│  ┌─────────────┐ ┌─────────────┐                                    │
│  │ QuickBooks  │ │ Xero        │  ← Connect ERP, get connectionId  │
│  │ Connected   │ │ Configure   │                                    │
│  └─────────────┘ └─────────────┘                                    │
│                                                                      │
│  COMPLIANCE (eTIMS)                                                  │
│  ┌─────────────────────────────┐                                    │
│  │ eTIMS (OSCU)                 │  ← Connect KRA credentials;     │
│  │ Connect                      │    use ERP above as data source   │
│  └─────────────────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────┘

  API Keys | Webhooks | Connections | Sync Batches | Compliance Status
```

The **same connection** (e.g. QuickBooks for company X) feeds both:
- Developer's sync workflows (expenses, customers, etc.)
- Compliance document submission (invoices → OSCU)

**Single connection, multiple consumers.** No duplication.

### 4.4 Where the "Merge" Does NOT Happen (CFO UI)

CFO sees **Compliance-only** UI. No API keys, no connectionIds. They click "Connect QuickBooks" → Link opens → Connection stored. Compliance UI abstracts Sync2Books; the CFO never needs to know about Applications or API keys.

---

## 5. Shared UI Strategy: Developer vs CFO

The Sync2Books dashboard is **developer-optimised**: API keys, connectionIds, webhooks, sync batches. This UI is **shared** by:

| Persona | Uses Dashboard? | What they see |
|---------|----------------|---------------|
| Developer | Yes | Full: API keys, connections (QB, Xero, Compliance), webhooks, sync status |
| CFO (Standalone) | No | Compliance-only UI; no API keys, no connectionIds |
| Platform Builder | Yes | Same as Developer; maybe white-label |

**Compliance standalone UI** is a separate, CFO-focused UI:
- No API key management
- No webhook configuration
- Simplified "Connect QuickBooks" (embeds Link)
- Document status, ETR receipts, reconciliation, reports

**Developers** get the full dashboard; **CFOs** get the simplified Compliance UI. Both rely on the same Sync2Books backend for ERP data.

---

## 5. Coupling: How to Keep It Loose

### 5.1 Compliance Depends on Sync2Books (Intentional)

- Compliance **calls** Sync2Books APIs for ERP data
- Compliance **does not** depend on Sync2Books for its own domain (documents, OSCU, validation)
- If Sync2Books is down, Compliance can still serve **standalone** users who already have data (e.g. manual entry, batch import) – but live ERP sync would fail

### 5.2 Sync2Books Depends on Compliance (Optional)

- Sync2Books **orchestrates** compliance flow when Compliance is enabled
- Sync2Books **calls** Compliance API to submit documents
- If Compliance is down, Sync2Books continues; compliance submissions queue or fail gracefully

### 5.3 Contract-First Boundaries

| Layer | Owner | Contract |
|-------|-------|----------|
| ERP data (invoices, customers, items) | Sync2Books | Sync2Books API (OpenAPI) |
| Compliance operations (submit, validate, reconcile) | Compliance | Compliance API (unified-compliance-api.yaml) |
| Identity (applicationId, companyId, connectionId) | Sync2Books | Passed in headers or body |

**Loose coupling rules:**
1. No shared database
2. No direct service discovery; use HTTP/gRPC with versioned contracts
3. Each service owns its domain model
4. Idempotency keys for cross-service calls

---

## 6. Contract Summary: Pre-Implementation

### 6.1 Sync2Books Must Provide (for Compliance as Consumer)

- [ ] **Data Source APIs** (or existing ones documented):
  - List/fetch invoices by company/connection
  - List/fetch customers, items
  - Create/update attachment (ETR receipt) on invoice
  - Connection metadata (status, integrationKey)
- [ ] **Auth:** API key validation; optional `x-application-id`, `x-company-id`, `x-connection-id`
- [ ] **Webhooks (optional):** Notify Compliance when invoice created/updated (so Compliance can pull and submit)

### 6.2 Compliance Must Provide (for Sync2Books / Developers)

- [ ] **Document submission:** `POST /documents` with idempotency
- [ ] **Item sync:** `POST /items`
- [ ] **Stock movement:** `POST /inventory/movements`
- [ ] **Status/queries:** `GET /documents`, `GET /documents/:id`
- [ ] **Auth:** API key or JWT; accept context headers from Sync2Books

### 6.3 Shared Infrastructure (No New Build)

- [ ] **Link component** – used by Developer (in their app) and by Compliance (in standalone UI) for QB/Xero connection
- [ ] **Connection model** – Sync2Books stores connection; Compliance holds `connectionId` reference
- [ ] **Application model** – Developer has Application + API key; Compliance can have its own Application for standalone users

---

## 7. Identity Model: Mapping the Two Worlds

| Scenario | Sync2Books Application | Sync2Books Company | Sync2Books Connection | Compliance |
|----------|------------------------|--------------------|------------------------|------------|
| Developer | Developer's app | Developer's customer (SMB) | QB/Xero connection | merchantId = companyId |
| CFO Standalone | Compliance app (platform-owned) | Created when CFO connects QB | QB connection | merchantId = compliance org |
| Embedded | Developer's app | Same as Developer | QB + Compliance connection | Same context |

For **CFO standalone:** When CFO connects QB via Compliance UI:
1. Compliance creates (or uses) a Sync2Books Application (e.g. "Compliance Standalone")
2. Compliance creates a Company for the CFO's org (or links to existing)
3. User completes Link OAuth → Connection created in Sync2Books
4. Compliance stores: `connectionId`, `companyId` for that org
5. All subsequent data fetches: Compliance calls Sync2Books with `connectionId` / `companyId`

---

## 8. Data Flow by Persona

### 8.1 CFO (Standalone Compliance UI)

```
CFO                    Compliance UI              Sync2Books              Compliance API         OSCU
 │                           │                         │                         │                │
 │  1. Connect QuickBooks    │                         │                         │                │
 │─────────────────────────►│  2. Embed Link / OAuth   │                         │                │
 │                          │────────────────────────►│                         │                │
 │                          │  3. Connection created   │                         │                │
 │                          │◄─────────────────────────│                         │                │
 │                          │  (store connectionId)    │                         │                │
 │                          │                         │                         │                │
 │  4. View invoices to     │  5. GET /invoices        │                         │                │
 │     submit               │────────────────────────►│                         │                │
 │                          │  6. Invoice list         │                         │                │
 │                          │◄────────────────────────│                         │                │
 │                          │  7. POST /documents (with connectionId context)     │                │
 │                          │─────────────────────────────────────────────────►│                │
 │                          │                         │              8. Submit   │                │
 │                          │                         │─────────────────────────────────────────►│
 │                          │                         │              9. ETR     │                │
 │                          │                         │◄────────────────────────────────────────│
 │                          │  10. Push ETR to QB     │                         │                │
 │                          │────────────────────────►│                         │                │
 │  Document submitted ✓    │                         │                         │                │
 │◄─────────────────────────│                         │                         │                │
```

### 8.2 Developer (Sync2Books Dashboard + API)

```
Developer App           Sync2Books              Compliance API         OSCU
     │                       │                         │                │
     │  POST /invoices        │                         │                │
     │  (or webhook)         │                         │                │
     │──────────────────────►│                         │                │
     │                       │  POST /documents         │                │
     │                       │  (or Compliance pulls   │                │
     │                       │   via webhook)           │                │
     │                       │────────────────────────►│                │
     │                       │                         │  Submit        │
     │                       │                         │───────────────►│
     │                       │  201 + oscuReceipt       │                │
     │                       │◄────────────────────────│                │
     │  Webhook: compliance. │                         │                │
     │  document.submitted   │                         │                │
     │◄──────────────────────│                         │                │
```

### 8.3 Shared Architecture (One Connection, Two Consumers)

```
                    Sync2Books Platform
                    ┌────────────────────────────────────┐
                    │  Connection: company_123 + QB      │
                    │  (invoice, customer, item sync)   │
                    └──────────────┬────────────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
           ▼                       ▼                       ▼
    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
    │ Developer    │      │ Compliance   │      │ Future       │
    │ App          │      │ Engine       │      │ Consumer     │
    │              │      │              │      │              │
    │ Reads        │      │ Reads +     │      │ Same APIs   │
    │ invoices,    │      │ Submits to   │      │              │
    │ syncs data   │      │ OSCU         │      │              │
    └──────────────┘      └──────────────┘      └──────────────┘
```

---

## 9. Summary: What to Build vs Reuse

| Capability | Reuse | Build |
|------------|-------|-------|
| ERP connection (QB, Xero) | Sync2Books Link, Connections | Nothing |
| API keys, Applications | Sync2Books | Nothing |
| Invoices, customers, items APIs | Sync2Books (extend if needed) | Nothing |
| Webhooks | Sync2Books | Compliance as subscriber |
| Compliance submission, validation, OSCU | Nothing | Compliance Engine |
| Developer dashboard (API keys, connections, webhooks) | Sync2Books | Add Compliance integration section |
| CFO dashboard (documents, ETR, reports) | Nothing | Compliance standalone UI |
| ETR receipt → QB attachment | Sync2Books attachment API | Compliance calls it after OSCU success |

---

*Document version: 1.0 | Last updated: 2025-02-14*
