# Inventory & Multi-Branch Specification

---

# Core Rule

Stock is scoped per branch (bhfId).

Never compute stock globally.

---

# Stock Update Rule

Stock must only change through StockMovement.

Direct updates forbidden.

---

# Movement Types

- SALE (negative)
- PURCHASE (positive)
- TRANSFER_OUT (negative)
- TRANSFER_IN (positive)
- ADJUSTMENT
- RETURN

---

# Inter-Branch Transfer

Transfer A → B requires:

1. TRANSFER_OUT in A
2. TRANSFER_IN in B

Both must succeed or rollback.

---

# Concurrency Rule

Stock updates must be atomic:

UPDATE inventory
SET quantity_on_hand = quantity_on_hand - X
WHERE branch_id = ?
AND quantity_on_hand >= X

If no rows affected → reject sale.
