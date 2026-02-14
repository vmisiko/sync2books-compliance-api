# Retry, Queue & Idempotency Specification

---

## Retry Conditions

Retry only on:
- Network failure
- Timeout
- 5xx error

Do not retry on:
- Validation failure
- Mapping missing
- Business rule violation

---

## Backoff Strategy

Exponential backoff:
1m → 5m → 15m → 1h → 6h

Max retries configurable.

---

## Dead Letter Queue

After max retries:
- Mark permanently failed
- Alert merchant
