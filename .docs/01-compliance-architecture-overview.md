# System Context & Compliance Philosophy

## Purpose

This system acts as a Unified Compliance Abstraction Layer between:

- ERP systems (QuickBooks, Xero, custom ERPs)
- Internal accounting systems
- eTIMS / OSCU APIs

It is NOT:
- A wrapper around OSCU APIs
- A thin proxy
- A simple transport adapter

It IS:
- A regulatory enforcement engine
- A compliance domain model
- A stock ledger authority per branch
- A validation and mapping orchestrator
- A submission reliability engine

---

# Core Regulatory Truths

1. Compliance is branch-scoped (bhfId).
2. Items must be registered before invoice reference.
3. Stock movements must be reported per branch.
4. Documents are immutable once submitted.
5. Reverse flows must preserve audit integrity.
6. Classification and tax codes must not drift silently.
7. ERP data cannot be blindly trusted.

---

# System Boundaries

ERP → Normalization → Compliance Core → OSCU Adapter → KRA

ERP is untrusted.
Compliance Core is authoritative.
OSCU Adapter is transport-only.

---

# Design Principles

- Immutable financial history
- Ledger-based inventory
- Snapshot item data at transaction time
- Validation before submission
- Idempotent submission
- Retry-safe architecture
- Explicit state machines
- Separation of concerns
