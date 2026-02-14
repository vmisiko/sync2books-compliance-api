# Document Lifecycle & State Machine

---

DRAFT
  ↓ validate
VALIDATED
  ↓ ensure items registered
ITEM_SYNC_REQUIRED
  ↓ register items
PENDING_SUBMISSION
  ↓ submit
SUBMITTED
  ↓
RECONCILED

On failure:

FAILED_SUBMISSION
FAILED_VALIDATION

---

State transitions must be explicit.
No implicit state jumps allowed.
