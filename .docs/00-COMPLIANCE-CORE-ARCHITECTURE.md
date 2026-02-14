# Compliance Core Architecture

**Design Philosophy**: Deterministic • Idempotent • Auditable • Regulation-isolated • ERP-agnostic

ERP is just a data source. eTIMS is just a regulatory sink. The compliance model sits in between.

---

## 1. Big Picture Flow

```
ERP Event
   ↓
Normalize → ComplianceDocument
   ↓
Validate → Rules Engine
   ↓
Build eTIMS Payload (EtimsPayloadBuilder)
   ↓
Submit
   ↓
Store Response + Events
   ↓
Update Status
```

---

## 2. Module Structure (Refactored)

| Module | Responsibility |
|--------|----------------|
| **catalog** | Items, classification, unit codes, item registration |
| **inventory** | Stock movements, stock levels per branch |
| **compliance** | Documents (sales, credit notes, reverse), validation, submission |

## 3. Layer Structure (Shared)

```
/domain
   compliance-document.entity.ts    # Aggregate root
   compliance-line.entity.ts
   compliance-item.entity.ts
   compliance-connection.entity.ts
   compliance-event.entity.ts       # Audit model

   compliance-status.enum.ts
   document-type.enum.ts
   tax-category.enum.ts
   source-system.enum.ts
   item-type.enum.ts
   connection-status.enum.ts
   connection-environment.enum.ts

   state-machine/compliance-state-machine.ts
   invariants/document-invariants.ts
   utils/idempotency.util.ts
   value-objects/validation-result.vo.ts

/rules
   structural-rule.engine.ts
   tax-rule.engine.ts
   classification-rule.engine.ts
   pin-rule.engine.ts
   compliance-rules.engine.ts

/application
   use-cases/
     create-document.usecase.ts
     validate-document.usecase.ts
     prepare-document.usecase.ts
     submit-document.usecase.ts
   ports/
     repository.port.ts
     etims-adapter.port.ts
     erp-adapter.port.ts

/infrastructure
   mapping/
     etims-payload.types.ts
     etims-payload.builder.ts       # Transformation boundary
   adapters/
     etims-adapter.stub.ts          # Replace with OSCU impl
   persistence/
     repository.stub.ts              # Replace with TypeORM etc.
```

---

## 4. State Machine

| From | To |
|------|-----|
| DRAFT | VALIDATED, CANCELLED |
| VALIDATED | READY_FOR_SUBMISSION |
| READY_FOR_SUBMISSION | SUBMITTED |
| SUBMITTED | ACCEPTED, REJECTED, FAILED |
| REJECTED | RETRYING, FAILED |
| RETRYING | SUBMITTED |
| ACCEPTED, FAILED, CANCELLED | (terminal) |

---

## 5. Invariants (Must Never Break)

- A document cannot be ACCEPTED without SUBMITTED
- A document cannot change lines after VALIDATED
- Historical invoices cannot be mutated
- Submission attempts must be counted
- All responses must be stored (ComplianceEvent)

---

## 6. Idempotency

```
idempotencyKey = merchantId + ":" + sourceDocumentId + ":" + documentType
```

---

## 7. Rules Engine

- **Structural**: lines ≥ 1, total = sum(lines), tax = sum(line VAT)
- **Tax**: VAT_STANDARD 16%, VAT_ZERO no tax, EXEMPT no VAT
- **Classification**: GOODS valid HS code, SERVICE prefix, unit required
- **PIN**: B2B vs B2C, malformed → reject

---

## 8. Audit Model

```
ComplianceEvent {
  documentId
  eventType: DOCUMENT_CREATED | VALIDATED | SUBMITTED | ACCEPTED | REJECTED | RETRY_ATTEMPTED
  payloadSnapshot
  responseSnapshot
  createdAt
}
```

---

## 9. Related Specs

- [01-compliance-architecture-overview.md](01-compliance-architecture-overview.md)
- [02-domain-model-specification.md](02-domain-model-specification.md)
- [03-validation-service-spec.md](03-validation-service-spec.md)
- [06-document-lifecycle-and-state-machine.md](06-document-lifecycle-and-state-machine.md)
- [07-oscu-adapter-spec.md](07-oscu-adapter-spec.md)
- [08-retry-queue-and-idempotency-spec.md](08-retry-queue-and-idempotency-spec.md)
