# Module Organization & Multi-Regulatory Strategy

**Purpose:** Advice on structuring compliance modules based on eTIMS capabilities, customer PINs, and future URA/Tanzania integrations.

---

## 1. What eTIMS/OSCU Actually Provides

From the OSCU integration guide and step-by-step flow:

| eTIMS Category | Your Action | Capabilities |
|----------------|-------------|--------------|
| **Basic data** | GET from eTIMS | Code list, **item classification list**, **PIN information** (customer PIN list!), branch list, notice list |
| **Branch** | SEND to eTIMS | Customer (head & branch) info, branch user accounts |
| **Item management** | SEND + GET | Item info, item list → **① Catalog** |
| **Imported item** | GET + SEND | Imported items (optional) |
| **Sales management** | SEND | **Sales transaction** then **sales invoice**; **credit note / cancel / refund** (same family) → **② Sales + Credit + Reverse** |
| **Purchase transaction** | GET + SEND | **Get** purchases from KRA; **send** confirmation → **③ Purchases** |
| **Stock management** | SEND | Stock in/out, stock inventory → **① Inventory** (after items + sales) |

**Key insight:** Sales invoices, credit notes, and reverse/cancel are all under **Sales management** in eTIMS. They share the same API family and flow. Splitting them into separate modules is optional—grouping them keeps the adapter simpler.

---

## 2. Customer PINs – Yes, eTIMS Has Its Own

**eTIMS maintains a PIN registry.** From Basic data:

- You **GET** "PIN information" from eTIMS (list of validated customer PINs).
- For B2B invoices you **send** `customerPin` on the invoice.
- eTIMS can validate that PIN against their registry.

**Implications:**

- **Your system:** Store/link customer PINs from ERP (QuickBooks customer tax field) and optionally validate via eTIMS Basic data.
- **ComplianceEntity:** Consider `ComplianceCustomer` or `BuyerRegistry` that syncs PIN info from eTIMS and links to ERP customers.
- **Validation:** Before submitting B2B invoice, you can optionally call eTIMS to verify customer PIN is in their system (or rely on eTIMS to reject at submit time).

---

## 3. Recommended Module Structure

**Not overkill** – modules make sense for:

- Clear boundaries
- Parallel development
- Easier testing and maintenance
- Alignment with eTIMS flow

### Option A: Domain-Aligned (Recommended)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  COMPLIANCE ENGINE                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  catalog/          Items + classification + unit codes                   │
│  inventory/         Stock movements, stock levels (per branch)           │
│  sales/             Sale invoices + credit notes + reverse invoicing     │
│  purchases/         Get purchases from regulator, send confirmation     │
│  connections/       Init, branch info, basic data sync, PIN list        │
│  mapping/           Tax, unit, classification mappings (regulation-agnostic) │
└─────────────────────────────────────────────────────────────────────────┘
```

| Module | Responsibility | Depends on |
|--------|----------------|------------|
| **catalog** | Item registration, classification, unit codes | connections, mapping |
| **inventory** | Stock movements, stock levels per branch | catalog, (sales for stock-out linkage) |
| **sales** | Invoices, credit notes, reverse invoices | catalog, inventory (stock-out), connections |
| **purchases** | Pull purchases, send confirmation | connections |
| **connections** | Init, branch, basic data, PIN list | – |
| **mapping** | Tax/unit/classification codes | – |

**Why group sale invoices + credit notes + reverse?**

eTIMS treats them as one "Sales management" flow. They share:

- Same document lifecycle
- Same validation rules
- Same ETR receipt handling
- Same adapter methods (different document type flag)

Separate modules for each would duplicate a lot. One **sales** module with `documentType: SALE | CREDIT_NOTE | REVERSE_INVOICE` is cleaner.

**Why separate purchases?**

eTIMS purchases are a **pull** flow (you GET from KRA, then SEND confirmation). Sales are a **push** flow. Different lifecycle, different adapter surface.

**Exports?**

- If eTIMS has export-specific endpoints → add `exports/` or extend `sales/` with `documentType: EXPORT`.
- If exports are just sales with different classification → keep in `sales/`.

---

### Option B: Finer Split (If You Prefer)

| Module | Contents |
|--------|----------|
| catalog | Items, classification, units |
| inventory | Stock only |
| invoices | Sale invoices only |
| credit-notes | Credit notes |
| reverse-invoicing | Reverse/cancel |
| purchases | Purchases |
| connections | Init, branch, basic data, PIN |

**Trade-off:** More modules, more boundaries, but more adapter methods and possibly duplicated validation. eTIMS doesn’t separate these at the API level.

---

## 4. Multi-Regulatory: URA, Tanzania, etc.

**Design principle:** Regulation-agnostic core, pluggable adapters.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  COMPLIANCE CORE (regulation-agnostic)                                   │
│  - ComplianceDocument, ComplianceLine, ComplianceItem                    │
│  - State machine, rules engine, validation, audit                       │
│  - Shared domain model                                                   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
            │ Kenya (OSCU) │ │ Uganda (URA) │ │ Tanzania     │
            │ Adapter      │ │ Adapter      │ │ Adapter      │
            └──────────────┘ └──────────────┘ └──────────────┘
```

### Abstraction: Regulatory Adapter Interface

```ts
// Shared port - each country implements
interface IRegulatoryAdapter {
  jurisdiction: 'KE' | 'UG' | 'TZ';
  
  submitInvoice(document: ComplianceDocument, connection: ComplianceConnection): Promise<SubmissionResult>;
  submitCreditNote(document: ComplianceDocument, connection: ComplianceConnection): Promise<SubmissionResult>;
  submitReverseInvoice(document: ComplianceDocument, originalDocId: string, connection: ComplianceConnection): Promise<SubmissionResult>;
  
  registerItem(item: ComplianceItem, connection: ComplianceConnection): Promise<ItemRegistrationResult>;
  getItemList(connection: ComplianceConnection): Promise<RegulatoryItem[]>;
  
  submitStockMovement(movement: StockMovement, connection: ComplianceConnection): Promise<void>;
  
  getPurchases(connection: ComplianceConnection, filters?: PurchaseFilters): Promise<Purchase[]>;
  confirmPurchase(purchaseId: string, connection: ComplianceConnection): Promise<void>;
  
  getBasicData(connection: ComplianceConnection): Promise<BasicData>;  // codes, PIN list, etc.
}
```

### Regulation-Specific Differences

| Concern | Kenya (eTIMS/OSCU) | Uganda (URA) | Tanzania (TRA) |
|--------|---------------------|--------------|----------------|
| Auth | Communication key from init | Likely different | Likely different |
| PIN format | P + 10 digits | May differ | May differ |
| Tax codes | TX_01, TX_02, etc. | Different | Different |
| Document types | Sales, credit, cancel | Similar concepts, different codes | Similar concepts |
| API base URL | etims-api.kra.go.ke | URA endpoints | TRA endpoints |

### Implementation Strategy

1. **Shared:** `ComplianceDocument`, `ComplianceLine`, `ComplianceItem`, state machine, rules engine, `ComplianceEvent`, idempotency.
2. **Abstract:** `IRegulatoryAdapter` + `IRegulatoryConnection` (connection shape may vary by jurisdiction).
3. **Per jurisdiction:**
   - `OscuAdapter` (Kenya)
   - `UraAdapter` (Uganda)
   - `TraAdapter` (Tanzania)
4. **Mapping:** `tax_mappings`, `unit_mappings`, etc. add `jurisdiction` or use separate mapping tables per country.
5. **Customer identification:** Abstract as `BuyerTaxId` – Kenya uses KRA PIN, others use TIN/VAT numbers.

---

## 5. Summary

| Question | Answer |
|----------|--------|
| **Module split?** | Yes. Align with eTIMS: **catalog**, **inventory**, **sales** (invoices + credit + reverse), **purchases**, **connections**, **mapping**. |
| **Separate modules for invoices vs credit notes vs reverse?** | Optional. eTIMS groups them; one **sales** module is simpler. |
| **eTIMS customer PINs?** | Yes. eTIMS has a PIN list in Basic data. You GET it and can validate B2B customer PINs. |
| **URA / Tanzania later?** | Use an `IRegulatoryAdapter` with jurisdiction-specific adapters. Keep core domain and flows regulation-agnostic. |

---

## 6. Suggested NestJS Module Layout

```
src/
  compliance/
    compliance.module.ts          # Aggregates all
  catalog/
    catalog.module.ts
    catalog.service.ts
    item.entity.ts, ...
  inventory/
    inventory.module.ts
    stock-movement.entity.ts, ...
  sales/
    sales.module.ts
    document use cases (create, validate, submit)
    credit-note use cases
    reverse-invoice use cases
  purchases/
    purchases.module.ts
    get-purchases, confirm-purchase use cases
  connections/
    connections.module.ts
    init, branch, basic-data, pin-list
  adapters/
    regulatory-adapter.port.ts    # IRegulatoryAdapter
    oscu/
      oscu-adapter.ts             # Kenya
    ura/
      ura-adapter.ts              # Uganda (future)
    tra/
      tra-adapter.ts              # Tanzania (future)
```

---

*Document version: 1.0 | Last updated: 2025-02-14*
