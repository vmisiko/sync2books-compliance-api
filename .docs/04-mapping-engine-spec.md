# Mapping Engine Specification

Responsible for converting internal business attributes into OSCU-compliant codes.

---

## Required Mapping Tables

- tax_mappings
- unit_mappings
- classification_mappings
- document_type_mappings
- payment_type_mappings

---

## Mapping Strategy

Never hardcode OSCU codes in business logic.
All conversions must go through mapping tables.

---

## Classification Resolution Order

1. Explicit merchant override
2. Rule-based engine
3. Default fallback classification

---

## Tax Mapping

Internal VAT_STANDARD → TX_01
Internal VAT_ZERO → TX_02

Mapping must be versioned.

---

## Mapping Validation

If mapping missing:
- Reject document
- Emit compliance error
