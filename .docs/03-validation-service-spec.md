
---

# 03-validation-service-spec.md

```md
# Validation Service Specification

This service enforces all compliance invariants BEFORE submission.

---

# Validation Phases

## Phase 1: Structural Validation

- Document must have lines
- Branch must exist
- Currency must be configured
- DocumentType must be valid enum

---

## Phase 2: Item Validation

For each line:

- Item exists
- Item active
- Classification exists
- Tax mapping exists
- Unit mapping exists
- Item registration status valid

---

## Phase 3: Stock Validation (GOODS only)

- quantityOnHand(branch) >= sale quantity
- Branch must match document branch
- Prevent negative stock unless config allows

---

## Phase 4: Financial Validation

- subtotal + tax = total
- Tax rates align with taxCategory
- Currency exchange rate present if foreign currency

---

## Phase 5: Compliance Validation

- Customer PIN required if threshold exceeded
- Reverse invoice must reference original
- Credit note cannot exceed original amount
- DocumentNumber unique per branch

---

# Validation Failure Handling

- Mark document FAILED_VALIDATION
- Persist failure reasons
- Do NOT attempt OSCU submission
