# Queue, Self-Healing Retry & Bulk Ingest — Implementation Plan

**Status:** proposed (not implemented)
**Scope:** `sync2books-compliance-api` (OSCU submission queue) + `nest-sync-2-books-api` (ERP sync + bulk ingest queue)
**Expands:** [`08-retry-queue-and-idempotency-spec.md`](./08-retry-queue-and-idempotency-spec.md) — that spec fixes the retry
*policy*; this document specifies the *mechanism*. Where they disagree, 08 wins on policy and this doc wins on mechanism.
**Also touches:** [`06-document-lifecycle-and-state-machine.md`](./06-document-lifecycle-and-state-machine.md),
[`11-...-sla-and-communication-spec.md`](./11-sync2books-compliance-inter-service-sla-and-communication-spec.md),
[`MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md`](./MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md)

---

## 0. Starting position (what the code does today)

Establishing this first, because three of the findings below change what "add a queue" has to mean.

| Concern | Today | Where |
|---|---|---|
| Async execution | `setImmediate(() => void this.processDocumentInBackground(id))` — in-process, fire-and-forget, lost on restart | `sales.service.ts:658` |
| ERP batch execution | `processSyncBatch()` — serial `for` loop over all items, called un-awaited with no `.catch()` | `sync.service.ts:444`, `invoice.service.ts:69` |
| Retry | Manual only: a user clicks Retry in the dashboard | `retry-sales.usecase.ts` |
| Retry state | `submissionAttempts` (int) on the document. No `nextAttemptAt`, no error class, no dead-letter marker | `compliance-document.orm-entity.ts:109` |
| `sync_items` retry state | **None at all** — a failed item is terminal until a human retries | `sync.entities.ts` |
| Retryability signal | String prefix: adapter writes `` `retryable: ...` ``, caller does `error?.includes('retryable')` | `etims-adapter.http.ts:358`, `submit-document.usecase.ts:214` |
| Backoff | None anywhere. Webhook sender has an in-process `sleep(2^n)` loop; its crons are commented out | `webhook-sender.service.ts:118`, `webhook-scheduler.service.ts:13` |
| Broker | None. `bill.service.ts:79` says it outright: *"processSyncBatch has no queue behind it"* | — |
| Redis | Already deployed (`docker-compose.yml` → `redis:7-alpine`), used for cache + Apigee token cache | `redis-cache.service.ts`, `etims.module.ts:31` |
| Deployment | PM2 `instances: 1, exec_mode: 'fork'` — single process serving API *and* background work | `ecosystem.config.js` |
| Async return path | **Already exists**: `POST /internal/compliance/oscu-outcome` + `invoice-receipt`, service-auth guarded | `compliance-callback.controller.ts` |
| Idempotency | Document creation is guarded by a unique index on `idempotencyKey` = `merchantId:sourceDocumentId:documentType` | `compliance-document.orm-entity.ts:126`, `create-document.usecase.ts:72` |

Two things are better than expected: **the callback (event return) path is already built**, and **document creation is
already idempotent at the DB level**. Those are the two hardest parts of an event-driven retry system, and they exist.

Three things are worse than expected, and they are why this plan is not just "npm i bullmq".

---

## 1. Three findings that constrain the design

### Finding 1 — the retryable classifier is wrong, and a queue multiplies the damage

`etims-adapter.http.ts` marks an OSCU reply retryable when `resultCd.startsWith('9')` (6 occurrences). Against the
code table in `oscu-api-response-codes.ts`, that sweeps in permanent failures:

| Code | Meaning | `startsWith('9')` says | Reality |
|---|---|---|---|
| `894` | error regarding server communication | retry | **correct** — transient |
| `999` | unknown error, ask administrator | retry | **correct** — treat as transient |
| `901` | it is not valid device | retry | permanent — device needs re-provisioning |
| `910` | request parameter error | retry | permanent — our payload is malformed |
| `921` | declared sales data cannot be received | retry | permanent — business rule |
| `922` | invoice data can be received after the sales data | retry | **dependency** — retry only after the prerequisite |
| `994` | there is an overlapped Data | retry | **already accepted** — retrying is actively harmful |
| `990` | maximum number of views exceeded | retry | permanent (read quota) |

The repo already contains the correct conservative answer — `isOscuRetryable(code)` returning only `894` and `999` —
and **it is dead code, referenced nowhere**. The adapter never calls it.

Today this is a bounded annoyance: retry is manual, so a human sees the error and stops. Under an automatic queue it
becomes: 1000 malformed invoices × 5 attempts × a 7h25m backoff ladder = 5000 doomed OSCU calls spread over a working
day, with the merchant told "retrying" the whole time and the real error (a bad payload) surfacing tomorrow.

**Fixing the classifier is a prerequisite for turning retries on, not a follow-up.**

### Finding 2 — `invcNo` forces per-tenant serialization, which caps bulk throughput

KRA requires `invcNo` to be strictly incrementing per TIN, and **only advances its own counter on ACCEPTED
submissions** — confirmed live 2026-08-11 and documented in `submit-document.usecase.ts:41`. Hence
`releaseInvoiceSequence()`, which rolls our counter back on a permanent rejection, but *only if nobody else advanced
past it*:

```ts
if (current === invcNo) { /* roll back */ }   // submit-document.usecase.ts
```

That guard is the whole story. If document A takes `invcNo` 5 and document B takes 6 concurrently, and A is rejected,
A **cannot** roll back — `current` is 6. Our counter is now permanently one ahead of KRA's, and every subsequent
submission for that TIN fails with a sequence error. A single concurrent pair can wedge a tenant's entire eTIMS feed.

Worse, `allocateInvoiceSequence()` is a non-atomic read-modify-write (`findOne` → `+1` → `upsert`), so two workers can
allocate *the same* number.

The same applies to the `itemCd` sequence on `saveItem` (noted in that same comment block).

**Consequence: all OSCU *write* calls for one `(kraPin, environment)` must be serialized end-to-end** — allocation,
submission, and outcome persistence inside one critical section. This is not a tunable; it is KRA's contract.

The honest arithmetic for the bulk case, using this repo's own SLA figure of `< 5s` per OSCU submit
(`11-...-sla-spec.md` §6.2), with 1.5s as an optimistic p50:

| Per-submit latency | 1000 invoices, serial |
|---|---|
| 1.5 s | ~25 min |
| 3 s | ~50 min |
| 5 s (SLA ceiling) | ~83 min |

**A 1000-invoice upload is a 25–85 minute job for one tenant, and no queue technology changes that.** The queue's job
is to make those minutes survivable and observable, not to make them go away. Parallelism is available *across*
tenants and in the pre-submission phases (validate, map, dedupe items) — never in the OSCU write itself.

This is the single most important thing to communicate to a client uploading 1000 invoices, and it must be designed
into the API shape (202 + progress) rather than discovered at minute 40 of a hanging HTTP request.

### Finding 3 — a timeout is not a failure, and retrying one creates duplicates

The adapter aborts at 30s (`etims-adapter.http.ts:148`). A timeout means *we do not know* whether KRA accepted. The
document keeps its `invcNo` (correctly — RETRYING reuses it), so a blind retry resubmits the same `invcNo`. If KRA had
in fact accepted, the retry returns `994` "overlapped Data" — which `startsWith('9')` classifies as retryable, so we
retry again, and again, until the ladder is exhausted and a **successfully filed invoice is dead-lettered as failed**.

The adapter already exposes what is needed to resolve this: `selectSalesTransactions()` and `selectInvoiceDetail()`.
Neither is used on the retry path.

---

## 2. Broker decision: BullMQ, not RabbitMQ

Both work. The evidence in this codebase points one way.

| Requirement (from spec 08 + the bulk use case) | BullMQ (Redis) | RabbitMQ |
|---|---|---|
| Per-job arbitrary delay: 1m → 5m → 15m → 1h → 6h | First-class (`delay`, `attempts`, custom `backoff`) | **Not native.** Needs the delayed-message-exchange plugin, or DLX+TTL cycling — one TTL per queue, so a 5-step ladder means 5 queues |
| Retry attempt counting | Built into the job | Manual: re-publish with a header counter |
| Pause/resume a whole queue during a KRA outage (§5.1) | `queue.pause()` | No equivalent; you stop consumers and hope |
| Reschedule *without* consuming an attempt (§5.2) | `job.moveToDelayed()` + `DelayedError` | Hand-rolled |
| Job introspection for a dashboard | Queryable job states | Queues are opaque; you need a side table anyway |
| Infrastructure already running | **Yes** — `redis:7-alpine` in compose, two Redis clients in code | New cluster, new failure mode, new runbook |
| Ops cost at current team size | Marginal | A broker to babysit |
| Throughput needed | ~1000 jobs/upload, KRA-bound at 1 job/1.5s/tenant | RabbitMQ's advantage (100k+ msg/s) is irrelevant here |
| Fan-out / multi-consumer routing | Weak | **Strong** |

The workload is **delayed, stateful, low-volume, single-consumer jobs with hour-scale backoff**. That is precisely
BullMQ's shape and precisely RabbitMQ's weak spot — hour-scale delays are the thing AMQP does worst. And the decisive
practical point: Redis is already provisioned and already has two clients in the codebase, while RabbitMQ is zero
percent deployed.

**Decision: BullMQ.**

**Where RabbitMQ would be the right answer, for the record:** if the two services later need real pub/sub decoupling —
several independent consumers of one `document.accepted` event (billing, analytics, notifications, a third service) —
that is topic-exchange work and Redis is the wrong tool. §7 keeps that door open by putting an outbox behind a port, so
the transport is one adapter swap. Do not pre-build it.

**Non-negotiable Redis operating conditions** (BullMQ loses jobs silently otherwise):
- `maxmemory-policy` **must** be `noeviction`. The existing cache Redis may be `allkeys-lru`; if so, **do not share it**.
- Use a dedicated instance, or at minimum a dedicated DB index per service, with persistence (AOF) on.
- Redis is the *scheduler*, never the *ledger* — see §3.

---

## 3. Core architectural principle: the database is the ledger, Redis is the scheduler

Every job is a pointer to a durable DB row. Job payloads carry ids and nothing else — no invoice bodies, no payloads.

```
                            source of truth
   ┌──────────────────────────────────────────────────────────────┐
   │  compliance_documents / sync_items  (MySQL)                   │
   │  status • attemptCount • nextAttemptAt • lastErrorClass       │
   │  leaseExpiresAt • deadLetteredAt                              │
   └──────────────────────────────────────────────────────────────┘
              ▲                                    ▲
              │ read/write outcome                 │ re-enqueue what Redis lost
              │                                    │
   ┌──────────┴───────────┐            ┌───────────┴────────────────┐
   │  BullMQ worker       │            │  ReconciliationCron (2 min) │
   │  (separate process)  │            │  the self-heal of last resort│
   └──────────┬───────────┘            └────────────────────────────┘
              │ dequeue
   ┌──────────┴────────────────────────────────────────────────────┐
   │  Redis  —  queues, delays, attempt counters                    │
   └───────────────────────────────────────────────────────────────┘
```

Why this ordering matters: if Redis is flushed or lost, **nothing is lost** — the reconciliation cron (§5.4) re-enqueues
from DB rows whose `nextAttemptAt` has passed. The system heals itself even from a broker wipe. If instead Redis held
the truth, a `FLUSHDB` would silently drop a merchant's tax filings, and this is tax data.

This also keeps CLAUDE.md's tenant-scoping rule intact: every re-enqueue query filters by `applicationId` /
`companyId`, so the isolation boundary stays in SQL where the rest of the system enforces it.

---

## 4. Queue topology

Each service owns its own queues and its own Redis DB index. The repos deploy independently (CLAUDE.md), so they must
not share a namespace.

### `sync2books-compliance-api` — Redis DB 1

| Queue | Job | Concurrency | Purpose |
|---|---|---|---|
| `oscu.submit` | `{ documentId }` | 20 global, **1 per `(kraPin, env)` via mutex** | The serialized OSCU write path (§4.1) |
| `oscu.prepare` | `{ documentId }` | 20 | DRAFT → VALIDATED → READY_FOR_SUBMISSION. Pure local work, safely parallel |
| `oscu.items` | `{ merchantId, itemCds[] }` | 1 per tenant (same mutex) | Deduped item registration before a bulk submit run |
| `oscu.probe` | `{ documentId }` | 10 | Verify-before-retry (§5.3) |
| `oscu.health` | `{ environment }` | 1, repeatable | Circuit-breaker health probe (§5.1) |
| `oscu.callback` | `{ documentId }` | 10 | Outbound callback to main API, retried independently |

### `nest-sync-2-books-api` — Redis DB 2

| Queue | Job | Concurrency | Purpose |
|---|---|---|---|
| `sync.item` | `{ syncItemId }` | 25 global, tunable per integration | One ERP write per job — replaces the serial loop in `processSyncBatch` |
| `sync.batch.finalize` | `{ syncBatchId }` | 5 | Roll up batch status + fire completion webhooks |
| `sync.ingest` | `{ ingestJobId, chunkIndex }` | 5 | Bulk ingest chunk persistence (§6) |
| `webhook.deliver` | `{ webhookEventId }` | 20 | Retires the commented-out cron and the blocking `sleep` loop |

### 4.1 The per-tenant mutex (the `invcNo` guard)

Per-key concurrency ("groups") is a **BullMQ Pro** feature. On OSS BullMQ, serialize with an explicit Redis mutex:

```
key:  oscu:lock:{kraPin}:{environment}
ttl:  90s   (> the adapter's 30s timeout, with renewal every 30s)
```

The lock is held across the **entire** critical section — allocate `invcNo` → submit → persist outcome → release or
roll back the sequence. Holding it only across allocation reintroduces Finding 2's gap.

If the lock cannot be acquired, the worker does **not** spin and does **not** fail:

```ts
// pseudocode — the attempt-preserving reschedule
const lock = await mutex.tryAcquire(key, 90_000);
if (!lock) {
  await job.moveToDelayed(Date.now() + jitter(2_000, 5_000), token);
  throw new DelayedError();   // requeued, attemptsMade untouched
}
```

`DelayedError` is the important detail: lock contention is not the document's fault, so it must not consume one of the
document's five real attempts.

Defence in depth on allocation, independent of the mutex: replace the `findOne` → `+1` → `upsert` in
`allocateInvoiceSequence()` with a `SELECT ... FOR UPDATE` inside a transaction. Two independent guards, because the
failure mode (a wedged tenant) is expensive and manual to unwind.

### 4.2 Worker process separation

PM2 currently runs one `fork` instance serving API traffic and background work in the same event loop. A 25-minute
bulk run would compete with request handling. Add a second bootstrap and a second PM2 app:

```
src/main.ts      → HTTP only  (no Worker instantiation)
src/worker.ts    → Workers only (no HTTP listener)
```

Gate it on `APP_ROLE=api|worker|both`, defaulting to `both` so local dev and the current deploy keep working unchanged.
Workers scale horizontally from day one; the mutex makes multiple worker processes safe.

---

## 5. Self-healing mechanics

### 5.1 Circuit breaker — the actual answer to "KRA is always down"

This is the heart of the request, and plain per-job backoff does **not** solve it. Spec 08's ladder
(1m → 5m → 15m → 1h → 6h) totals **7h25m**. A KRA outage longer than that dead-letters every in-flight document even
though nothing was wrong with any of them. Multi-hour eTIMS outages are routine.

A circuit breaker per `(environment)` — outages are endpoint-wide, not tenant-specific:

```
CLOSED  ──  N consecutive TRANSIENT failures (default 5)  ──▶  OPEN
                                                                │
OPEN    ──  queue.pause('oscu.submit')                          │
            oscu.health probes selectNoticeList() every 60s     │
            (a cheap read-only call, no sequence, no side effect)│
                                                                ▼
HALF_OPEN ── 1 probe succeeds ──▶ resume queue, admit a trickle
            ── first success ──▶ CLOSED, full concurrency
            ── failure ──▶ back to OPEN, probe interval ×2 (cap 15 min)
```

State lives in Redis (`oscu:circuit:{env}`) so all workers agree, and is mirrored to a DB row so the dashboard and an
operator can see it without a Redis client.

**The rule that makes this self-healing rather than self-destructing: while the circuit is OPEN, no document consumes
an attempt.** Jobs are rescheduled with `moveToDelayed` + `DelayedError`, exactly as in §4.1. A 3-day KRA outage
therefore costs zero attempts, and when KRA returns, the backlog drains in `invcNo` order with all five attempts intact.

Merchant-facing wording follows from the circuit state, which is the difference between a trustworthy dashboard and an
alarming one: *"KRA eTIMS is unavailable — 412 invoices queued, submitting automatically when service returns"* rather
than *"412 failed"*.

### 5.2 Error taxonomy (replaces the `retryable:` string, fixes Finding 1)

A typed classification returned by the adapter, alongside the human message. Keep the string for one deploy cycle for
backward compatibility (CLAUDE.md: cross-repo changes are not atomic), then remove it.

```ts
export type OscuFailureClass =
  | 'TRANSIENT'    // retry on the 08 ladder
  | 'OUTAGE'       // feeds the circuit breaker; no attempt consumed
  | 'DUPLICATE'    // KRA already has it → probe and adopt (§5.3)
  | 'DEPENDENCY'   // prerequisite missing → retry after resolving it
  | 'PERMANENT'    // never retry → dead-letter immediately, alert merchant
  | 'AUTH';        // credential/device problem → alert operator, do not retry
```

Mapping (single source of truth; `isOscuRetryable()` gets rewritten to delegate here, so it stops being dead code):

| Signal | Class |
|---|---|
| `ECONNRESET`, `ETIMEDOUT`, `AbortError`, DNS failure | `OUTAGE` |
| HTTP 502 / 503 / 504 | `OUTAGE` |
| HTTP 500, 408, 429 | `TRANSIENT` (429 → honour `Retry-After` if present) |
| OSCU `894` (server communication), `999` (unknown) | `TRANSIENT` |
| OSCU `994` (overlapped data) | `DUPLICATE` |
| OSCU `922` (invoice before sales data) | `DEPENDENCY` |
| OSCU `901`/`902`/`903` (device), `900` (no header) | `AUTH` |
| OSCU `910`/`911`/`912`/`921`/`990`/`991`/`992`/`993` | `PERMANENT` |
| OSCU `891`–`893`, `895`, `896`, `899` (client-side) | `PERMANENT` |
| Local validation / mapping / business-rule failure | `PERMANENT` (matches spec 08's do-not-retry list) |
| Unrecognised code | `TRANSIENT`, capped at 2 attempts, logged as unclassified |

`PERMANENT` and `AUTH` throw BullMQ's `UnrecoverableError` — failed once, no ladder, dead-lettered immediately. That
alone converts Finding 1's 5000 doomed calls into 1000 honest failures surfaced in the first minute.

**Unclassified codes must be logged loudly and reviewed.** The mapping above is derived from the spec's code table, not
from live observation of every code; treat it as a starting point that a week of production logs will correct.

### 5.3 Verify-before-retry (fixes Finding 3)

Before resubmitting any document where `submittedAt != null && etimsReceiptNumber == null` — i.e. we sent it and never
learned the outcome — enqueue `oscu.probe` first:

1. Call `selectSalesTransactions` / `selectInvoiceDetail` for that `(kraPin, bhfId, invcNo)`.
2. **Found, accepted** → adopt the receipt. RETRYING → SUBMITTED → ACCEPTED, both legal transitions today. Append an
   `ACCEPTED` event with a `reconciledFromProbe: true` marker. No resubmission.
3. **Not found** → resubmit under the mutex, reusing the same `invcNo`.
4. **Probe itself fails** → treat as `OUTAGE`, reschedule, do not resubmit blind.

Same routine handles a `DUPLICATE` (`994`) reply: probe, adopt, done.

This is what turns at-least-once delivery into effectively-once *filing*, which is the property that actually matters
for tax. Without it, every KRA timeout is a coin flip between a lost invoice and a double-filed one.

### 5.4 Reconciliation cron — self-healing the self-healer

Every 2 minutes, per service, tenant-scoped:

```sql
-- documents that should have a live job and may not
SELECT id FROM compliance_documents
WHERE complianceStatus IN ('RETRYING','READY_FOR_SUBMISSION')
  AND deadLetteredAt IS NULL
  AND (nextAttemptAt IS NULL OR nextAttemptAt <= NOW())
  AND (leaseExpiresAt IS NULL OR leaseExpiresAt < NOW())
LIMIT 500
```

Re-enqueue each with `jobId = 'oscu.submit:' + documentId`. BullMQ rejects a duplicate `jobId` while the job exists, so
this is naturally idempotent — it fills gaps and never double-schedules.

This one cron covers: Redis flushed, a job lost to a worker OOM, a row written before its `queue.add` succeeded, and a
deploy that dropped in-flight jobs.

### 5.5 Stalled-lease reaper

Today a crash mid-item leaves `sync_items.status = 'syncing'` forever — invisible, unretried. Add `leaseExpiresAt`, set
it on claim, renew during long work, and every 5 minutes reclaim rows whose lease expired: back to `pending`, attempt
count incremented, re-enqueued. BullMQ's own stalled-job detection covers the Redis side; this covers the DB row, which
is the side that matters.

### 5.6 Dead-letter queue

Spec 08: *"after max retries — mark permanently failed, alert merchant."*

**The DLQ of record is the database, not Redis.** BullMQ's failed set is fine for inspection but is trimmed, unqueryable
by tenant, and lost with the instance. Dead-lettering sets `deadLetteredAt`, `lastErrorClass`, `lastErrorMessage`,
`attemptCount` on the row.

**Critically — no new enum values.** CLAUDE.md forbids widening closed enums, and `syncStatus` is exactly
`pending | syncing | synced | failed` while the document lifecycle is fixed by the state machine. A dead-lettered
document is `FAILED` with `deadLetteredAt` set; a dead-lettered sync item is `failed` with `deadLetteredAt` set. Every
consumer in the other three repos keeps working with zero changes. Replay uses the existing `FAILED → RETRYING`
transition, which the state machine already permits.

Alerting on the `deadLetteredAt` transition, distinguishing audiences:
- `PERMANENT` → merchant: their data needs fixing, with the specific field named.
- `AUTH` → operator: device/credential problem, no merchant action possible.
- `TRANSIENT` exhausted → both: KRA problem that outlasted the ladder.

---

## 6. Bulk ingest: 1000 invoices from an ERP

### 6.1 What breaks today

| # | Problem | Consequence at 1000 items |
|---|---|---|
| 1 | `processSyncBatch` is a serial in-process loop, called un-awaited | 25–85 min of work on the API event loop; the caller's HTTP request either times out or returns a lie |
| 2 | Floating promise with no `.catch()` (`invoice.service.ts:69`) | Unhandled rejection; on some Node configs, process exit |
| 3 | Process restart mid-batch | Items stranded in `syncing` forever (§5.5) |
| 4 | One failed item is terminal | No retry ever; merchant must find and re-click each one |
| 5 | `@AfterLoad computeItemCounts()` loads every `syncItems` row to count them | Dashboard polling a batch loads 1000 rows per poll, per poll |
| 6 | No unique constraint on `sync_items` | Client re-POSTs the same 1000 → 2000 rows → double ERP writes |
| 7 | No fairness | One tenant's 1000 starves every other tenant behind it |

### 6.2 Target flow

```
POST /invoices/bulk   (up to 1000)
   │
   ├─ validate envelope only (shape, count cap, auth, tenant scope)
   ├─ INSERT ingest_jobs row + sync_batch (status=pending)
   ├─ enqueue sync.ingest chunk jobs (200 rows each)
   └─▶ 202 Accepted { batchId, ingestJobId, statusUrl }        ← returns in < 300 ms
   
sync.ingest (per chunk, parallel)
   └─ bulk INSERT ... ON DUPLICATE KEY UPDATE  → idempotent, chunked
   
   ▼ all chunks done
oscu.items  (once per batch, deduped)
   └─ 1000 invoices typically reference ~50 distinct items
      → register 50, not 1000, under the tenant mutex
   
   ▼
FlowProducer: parent sync.batch.finalize
              └── 1000 children (sync.item / oscu.submit)
   
   ▼ parent runs when every child settles
finalize: SQL aggregate roll-up + completion webhook + merchant notification
```

Design decisions and why:

**One job per item, not per batch.** A batch-level job reproduces the current serial loop with all its coupling: one
poison item stalls 999 healthy ones, retry granularity is the whole batch, and progress is invisible. Per-item jobs
give independent retry, independent backoff, real progress, and per-item error attribution. Cost is 1000 Redis entries
per batch — trivial.

**Parent/child flow for completion.** `FlowProducer` runs the parent only after every child settles, so batch
completion is event-driven instead of polled. This directly replaces `updateSyncBatchStatusAfterRetry()`'s row-counting.

**Fix #5 before shipping bulk.** Replace `@AfterLoad computeItemCounts()` with a single grouped aggregate:

```sql
SELECT status, COUNT(*) FROM sync_items WHERE syncBatchId = ? GROUP BY status
```

Keep the computed properties on the entity for API compatibility, but populate them from the aggregate. Without this,
the progress endpoint the 202 response points at becomes the system's own worst client.

**Fix #6 with a unique index**, mirroring the compliance side's proven `idempotencyKey` pattern:

```
UNIQUE KEY uq_sync_items_dedupe (syncBatchId, entityType, entityId)
```

Plus an ingest-level idempotency key so a client retrying the whole POST (a network blip on a 1000-item upload is
likely) resolves to the same `batchId` rather than a second batch.

**Fairness (#7).** Per-tenant concurrency caps on `sync.item` so one bulk upload cannot monopolise workers. On OSS
BullMQ, either a Redis semaphore per `companyId` (same primitive as §4.1, with a cap of N instead of 1), or split
interactive and bulk traffic into two queues with separate worker pools — `sync.item` for single user-triggered writes,
`sync.item.bulk` for ingest fan-out, the bulk pool sized smaller. **Recommend the two-queue split**: simpler, no lock
contention, and it makes the priority explicit — a user clicking "sync this invoice" must never wait behind a 1000-item
import.

**Cap the request.** 1000 per call, `413` above it with a documented cursor pattern for more. An uncapped bulk endpoint
is a denial-of-service vector against the tenant's own queue.

### 6.3 Progress and expectation-setting

`GET /sync-batches/:id/status` returns the aggregate plus, when the circuit is open, *why* nothing is moving:

```json
{
  "batchId": "...", "status": "in_progress",
  "total": 1000, "synced": 412, "failed": 3, "pending": 585,
  "deadLettered": 1,
  "blockedBy": { "reason": "KRA_OUTAGE", "since": "2026-09-07T09:14:00Z", "retryingAt": "2026-09-07T09:24:00Z" },
  "estimatedCompletion": "2026-09-07T10:32:00Z"
}
```

`estimatedCompletion` is computed from observed per-submit latency × remaining ÷ effective per-tenant concurrency (1).
Given Finding 2, telling the client "about 50 minutes" up front is the difference between a working feature and a
support ticket.

---

## 7. Data model changes

Additive only. No enum widened, no column dropped, no existing column's meaning changed — so every other repo keeps
working through the deploy.

### `sync2books-compliance-api` — `compliance_documents`

| Column | Type | Purpose |
|---|---|---|
| `attemptCount` | `int not null default 0` | Real attempts. Distinct from `submissionAttempts`, which counts OSCU calls made; this counts *retry ladder steps consumed*, and outage/lock reschedules do not increment it |
| `nextAttemptAt` | `datetime null` | Drives the reconciliation cron |
| `lastErrorClass` | `varchar(20) null` | `OscuFailureClass` |
| `lastErrorMessage` | `text null` | Operator-facing detail |
| `leaseExpiresAt` | `datetime null` | Stalled-lease reaper |
| `deadLetteredAt` | `datetime null` | DLQ marker — *not* a new status |
| `probeOutcome` | `json null` | Audit trail for §5.3 adoptions |

Index: `(complianceStatus, nextAttemptAt, deadLetteredAt)` — the reconciliation query's access path.

### `nest-sync-2-books-api` — `sync_items`

Same six retry columns (`attemptCount`, `nextAttemptAt`, `lastErrorClass`, `lastErrorMessage`, `leaseExpiresAt`,
`deadLetteredAt`), plus the unique dedupe index from §6.2. New `ingest_jobs` table for bulk envelope tracking.

Per `.claude/rules/migrations.md` (loads on `src/migrations/**`) — follow that file's conventions; these are additive
`ALTER TABLE`s with defaults, safe to apply before the code that reads them, which is what makes the phasing in §9 work.

### `circuit_state` (both services)

One row per `(service, environment)`: `state`, `openedAt`, `consecutiveFailures`, `lastProbeAt`, `nextProbeAt`. Redis
holds the hot copy; this row exists so the dashboard and an operator can read circuit state without a Redis client.

### Outbox (deferred, port only)

Define `IDomainEventPublisher` with a BullMQ adapter now. Adding a `domain_events` outbox table later, or swapping to
RabbitMQ, then touches one adapter. **Do not build the outbox in this plan** — nothing yet needs multi-consumer fan-out,
and an unused outbox is a table that drifts out of correctness.

---

## 8. Cross-repo contract changes

CLAUDE.md: the repos deploy separately, so a shared-contract change must be backward-compatible for at least one deploy
cycle. Each item below is additive first, removal only after both sides ship.

1. **`POST /compliance/sales` gains an async mode.** Keep the existing synchronous behaviour as the default — the
   compliance dashboard (Mode B) and interactive single submits depend on it, and `MAIN_API_COMPLIANCE_SYNCHRONOUS_CONTRACT.md`
   is normative for Mode A. Add opt-in `Prefer: respond-async` (or `?async=true`), which enqueues and returns
   `202 { documentId, statusUrl }`, with the outcome arriving via the **already-built**
   `POST /internal/compliance/oscu-outcome` callback. Bulk uses async; interactive keeps sync. Update spec 11 §4.1,
   which currently records sync-only with "event-driven can be added later" — this is that later.

2. **Consume `x-idempotency-key`.** The main API has sent it since `compliance-http.service.ts:93`, and **nothing in
   compliance-api reads it** — only `x-sync2books-*` headers are parsed. Spec 11 §6.4 nonetheless promises "duplicate
   requests return cached result". Document creation is protected by its unique `idempotencyKey` index, but stock and
   item endpoints are not. Add a small idempotency-record table keyed on `(companyId, key, route)` storing the first
   response. This matters more once retries are automatic, because that is when duplicate requests stop being rare.

3. **Retire the `retryable:` string prefix.** Ship `failureClass` alongside it, migrate `submit-document.usecase.ts:214`
   off `error?.includes('retryable')`, then remove the prefix in a later deploy.

4. **Dashboard UI (`Next-Sync-2-books-compliance-dashboard-ui`).** Surface circuit state, `deadLetteredAt` vs ordinary
   failure, attempt count, and `nextAttemptAt`. Note per CLAUDE.md: **no test runner is installed there** — verify by
   driving the Mode-B flows in the browser, and type-check with `npx tsc --noEmit`, since `next build` ignores type
   errors in that repo.

5. **Docs.** Rewrite spec 08 to reference this mechanism; add the async submit mode to `openapi.json` /
   `unified-compliance-api.yaml`; document the bulk endpoint in `sync2BooksDocumentation`.

---

## 9. Phased implementation

Ordered so that **every phase is independently shippable and each one leaves the system better even if the next never
lands**. The classifier comes before the automation on purpose — turning on automatic retry with today's classifier
would make things worse, not better.

### Phase 0 — Correctness prerequisites *(no queue yet)*
1. `OscuFailureClass` taxonomy + classifier; rewrite `isOscuRetryable()` to delegate (kills the dead code).
2. Adapter returns `failureClass` alongside the existing string; `submit-document.usecase.ts` prefers it.
3. `allocateInvoiceSequence()` → `SELECT ... FOR UPDATE` in a transaction.
4. Additive migrations for all retry columns (no reader yet).
5. Replace `@AfterLoad computeItemCounts()` with a SQL aggregate.

**Tests:** unit table-test every code in `OSCU_API_RESPONSE_CODES` → expected class; concurrent-allocation test proving
two transactions cannot take the same `invcNo`. `pnpm run test` in both NestJS repos.
**Ships value alone:** stops misclassifying permanent errors as retryable, and stops the 1000-row dashboard query.

### Phase 1 — BullMQ foundation
1. `bullmq` + `@nestjs/bullmq`; dedicated Redis DB index; assert `noeviction` at boot and refuse to start otherwise.
2. `APP_ROLE` split (`main.ts` / `worker.ts`), second PM2 app, `docker-compose` worker service.
3. `oscu.submit` + `oscu.prepare`; `sales.service.ts:658`'s `setImmediate` becomes `queue.add`.
4. Spec-08 backoff as a custom BullMQ strategy: 1m, 5m, 15m, 1h, 6h.
5. `UnrecoverableError` for `PERMANENT`/`AUTH`.

**Tests:** e2e with a real Redis (`test/jest-e2e.json`) — enqueue, worker consumes, document reaches ACCEPTED; kill the
worker mid-job and assert the job is redelivered rather than lost.

### Phase 2 — Serialization and self-healing
1. Per-`(kraPin, env)` mutex with renewal; `moveToDelayed` + `DelayedError` on contention.
2. Circuit breaker + `oscu.health` repeatable probe on `selectNoticeList`.
3. Attempt-preserving reschedule while OPEN.
4. Reconciliation cron (2 min) + stalled-lease reaper (5 min).
5. Dead-lettering + tiered alerts.

**Tests:** the important ones are the adversarial ones —
- two concurrent submissions for one TIN → distinct `invcNo`, no gap, mutex observed;
- simulated 3-day outage (stubbed adapter) → zero attempts consumed, full drain on recovery, nothing dead-lettered;
- `FLUSHDB` mid-flight → reconciliation cron restores every document within one cycle;
- `SIGKILL` a worker mid-submit → lease expires, item reclaimed, no double submission.

### Phase 3 — Verify-before-retry
1. `oscu.probe` using `selectSalesTransactions` / `selectInvoiceDetail`.
2. Probe gate on every retry where `submittedAt != null && receipt == null`; `994` → probe-and-adopt.
3. `probeOutcome` audit trail.

**Tests:** stub a timeout-after-KRA-accepted; assert the retry adopts the receipt and never resubmits. Then, per
`feedback_verify_through_main_api`, live-fire against the KRA **sandbox** via the `etims-golive-testing` skill — never
production.

### Phase 4 — Bulk ingest
1. `POST /invoices/bulk` → 202 + `ingest_jobs` + chunked `ON DUPLICATE KEY UPDATE` inserts.
2. `oscu.items` dedupe pass before submission fan-out.
3. `FlowProducer` parent/child; `sync.batch.finalize` replaces row-counting.
4. `sync.item` / `sync.item.bulk` split for fairness.
5. Progress endpoint with `blockedBy` + `estimatedCompletion`.

**Tests:** 1000-item ingest against a stubbed ERP — assert 202 in < 300 ms, all 1000 settle, re-POSTing the identical
payload creates zero extra rows, and an interactive single sync submitted mid-run completes without waiting for the bulk.

### Phase 5 — Consolidation
1. `webhook.deliver` queue; delete the blocking `sleep` loop and the commented-out crons.
2. Migrate remaining `processSyncBatch` callers (expense, bill, bill-payment, supplier, invoice, etims-operational) off
   floating promises.
3. Remove the `retryable:` string prefix once both services ship.
4. Rewrite spec 08; update OpenAPI + docs site.

---

## 10. Observability and runbook

**Metrics** (per queue, per tenant, per environment): depth by state; job age p50/p95; `OscuFailureClass` counts;
circuit state + time-in-OPEN; dead-letter rate; mutex wait time; per-submit KRA latency; bulk batch throughput.

**Alerts:** circuit OPEN > 30 min • dead-letter rate > 1% of a batch • any `AUTH` failure (immediate — the tenant is
fully blocked) • queue depth growing while circuit is CLOSED (worker starvation) • reconciliation cron re-enqueuing more
than a handful per cycle (something upstream is dropping jobs) • mutex wait p95 > 30s (per-tenant saturation).

**Runbook entries to write:** KRA outage (expected: nothing to do, watch the circuit) • one tenant wedged on a sequence
gap (how to inspect and reset `oscu_sync_state`) • Redis lost (expected: cron heals; verify) • bulk batch stuck (which
queue, which lock) • replaying a dead-lettered document (`FAILED → RETRYING`).

**Config** — all env-driven, no secrets in source (CLAUDE.md):
`OSCU_QUEUE_REDIS_URL`, `OSCU_MAX_ATTEMPTS` (default 5), `OSCU_BACKOFF_LADDER_MS` (spec-08 default),
`OSCU_SUBMIT_CONCURRENCY` (20), `OSCU_CIRCUIT_FAILURE_THRESHOLD` (5), `OSCU_CIRCUIT_PROBE_INTERVAL_MS` (60000),
`OSCU_LOCK_TTL_MS` (90000), `SYNC_ITEM_CONCURRENCY` (25), `SYNC_BULK_CONCURRENCY` (5), `BULK_INGEST_MAX_ITEMS` (1000),
`BULK_INGEST_CHUNK_SIZE` (200), `APP_ROLE`.

---

## 11. Risks and decisions that need your call

| # | Risk | Mitigation / decision needed |
|---|---|---|
| 1 | **1000 invoices takes 25–85 min per tenant** and no technology fixes it (Finding 2) | Design-level accepted; mitigated by 202 + progress + ETA. **Decision: is that acceptable to the client, or do we need to negotiate a per-TIN sequence concession with KRA?** |
| 2 | The `OscuFailureClass` mapping is derived from the spec's code table, not from observed production traffic | Log every unclassified code loudly; review after one week of real traffic and correct. Treat the table as v1 |
| 3 | Redis with an eviction policy silently loses jobs | Boot-time assertion on `noeviction`; dedicated instance/index; reconciliation cron as the backstop |
| 4 | Circuit breaker could mask a *permanent* KRA change (e.g. a breaking API version) as an outage and retry forever | Cap total time in OPEN (default 24h) → dead-letter with an operator alert rather than retrying indefinitely |
| 5 | Making Mode A async changes a contract other repos depend on | Async is opt-in; sync stays the default for one full deploy cycle |
| 6 | Per-key concurrency is a BullMQ **Pro** (paid) feature | Using an OSS Redis mutex instead (§4.1). **Decision: if a BullMQ Pro licence is acceptable, groups would remove a meaningful chunk of §4.1's custom code** |
| 7 | Two more moving parts (worker process, Redis-as-broker) at single-instance scale | Phased; `APP_ROLE=both` keeps the current single-process deploy working throughout |
| 8 | `submissionAttempts` and the new `attemptCount` mean different things | Documented in the migration and the entity; consider renaming `submissionAttempts` → `oscuCallCount` in a later cycle, once nothing external reads it |

---

## 12. Summary of the recommendation

1. **BullMQ, not RabbitMQ** — the workload is hour-scale delayed jobs, which is BullMQ's strength and AMQP's weakness,
   and Redis is already deployed while RabbitMQ is not.
2. **The database stays the ledger; Redis is only the scheduler** — so a broker wipe cannot lose tax filings.
3. **Fix the retryable classifier before automating anything** — today's `startsWith('9')` would retry permanent
   failures 5× each for 7 hours; that is the one change that must precede the queue.
4. **Serialize OSCU writes per `(kraPin, environment)`** — KRA's `invcNo` contract requires it, and concurrency there
   can permanently wedge a tenant.
5. **A circuit breaker, not just backoff, is the answer to KRA downtime** — and while it is open, no document may
   consume a retry attempt.
6. **Probe before every uncertain retry** — the only way a timeout doesn't become either a lost or a double-filed invoice.
7. **Bulk = 202 + per-item jobs + deduped item registration + honest ETA**, with fairness so one import cannot starve
   interactive syncs.
8. **Nothing widens a closed enum**; every schema change is additive, so the other four repos ride through unchanged.
