# OSCU Adapter Specification

Transport-only layer.

Responsibilities:

- Transform ComplianceDocument → OSCU payload
- Transform StockMovement → OSCU payload
- Transform ComplianceItem → OSCU payload
- Handle authentication
- Handle signatures
- Normalize errors

---

# Idempotency

Store:

- requestHash
- receiptNumber
- timestamp

If duplicate request:
Return stored result.
