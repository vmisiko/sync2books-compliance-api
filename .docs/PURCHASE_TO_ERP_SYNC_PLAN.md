# Purchase invoice → ERP sync — decision + implementation plan

**Status (2026-08-27): Phases 0–2 done and tested, plus a same-day correctness fix.**
`syncToErp()` is live — a confirmed purchase with a supplier linked to an ERP-side record now
pushes as a vendor Bill to QuickBooks/Odoo via `MainApiPullClient.createBill()`, and as of
2026-08-27 that call awaits the real ERP write instead of marking `'synced'` the instant the
Bill is queued (see "Synchronous await instead of synced-means-queued" below — this was a real
bug in the original Phase 2 landing, not a hypothetical). Phases 3 (attachments) and 4
(surfacing/retry UX) are not built; webhook-driven completion notification was considered and
explicitly deferred (see "Deferred: webhook wiring" below) in favor of the synchronous fix.

## Synchronous await instead of synced-means-queued (2026-08-27)

The original Phase 2 landing had a real correctness gap: `POST /bills` is fire-and-forget
(returns before the ERP write happens), so `syncToErp()` was marking a purchase `'synced'` the
moment the Bill was successfully *queued* in main API — not once QuickBooks/Odoo had actually
confirmed it. This surfaced while discussing how attachments/payment should know when a bill
sync is "really" done.

Two mechanisms could answer that: block synchronously until the write completes, or fire a
webhook on completion and react to it. **Chose the synchronous option** — it was nearly free
here, since `syncToErp()` already loops through purchases one at a time in a single request, so
awaiting each one's real result adds no additional wall-clock the loop wasn't already
implicitly serializing.

**What changed:**
- `BillController.createBill` (`nest-sync-2-books-api/src/bill/controllers/bill.controller.ts`)
  gained an `awaitSync` query param, threaded into `BillService.createBill()`'s pre-existing
  `awaitSync` parameter (added by the `task_2c421500` follow-up for `createBillWithPayment`).
  Defaults to `false` (unchanged fire-and-forget) for existing/other callers.
- `MainApiPullClient.createBill()` now requests `awaitSync=true` by default (opt out via
  `{ awaitSync: false }`) and its response type carries `bill.syncStatus`/`bill.syncError` —
  the real outcome, not just "queued".
- `syncToErp()` now branches on `billResult.bill.syncStatus === 'synced'`: only then does it
  mark the purchase row `'synced'`; otherwise it goes through the same `fail()` path as any
  other error, using `bill.syncError` as the message. `erpBillId`/`erpSyncBatchId` are recorded
  either way (the Bill row exists in main API even when the ERP write itself failed — useful
  for debugging/retry).

Tests updated/added in `dashboard-purchases.syncToErp.spec.ts`: the success-path mock now
returns `syncStatus: 'synced'`, and a new case covers "Bill created in main API but the ERP
write failed" — a state that was previously indistinguishable from success.

## Deferred: webhook wiring

Considered as the alternative to the synchronous fix above, and explicitly **not built** —
revisit only once purchase syncing needs to move to a background/bulk job (holding one HTTP
request open per purchase stops making sense once syncing dozens at once). Found while
scoping this that the infrastructure is half-built already, just never wired together:

- `BILL_WRITE_SUCCESSFUL`/`BILL_WRITE_UNSUCCESSFUL` webhook event types and their
  `WebhookEventFactoryService` factory methods already exist in `nest-sync-2-books-api`, but
  are dead code — `SyncService.createBatchCompletionWebhookEvents()`'s entity-type dispatch
  only ever branches on `SyncEntityType.EXPENSE`, never `BILL`.
- compliance-api's inbound webhook receiver (`MainApiWebhookController`) and its subscription
  list (`SUPPORTED_INTEGRATION_KEYS`'s sibling, `SUBSCRIBED_EVENT_TYPES` in
  `main-api-connection.application.service.ts`) only cover `connection.*` events today, not
  `bill.write.*`.
- To build later: (1) branch on `BILL` in main API's batch-completion dispatcher, (2) add
  `bill.write.successful`/`bill.write.unsuccessful` to compliance-api's subscribed event types
  and a case in `handleInboundWebhookEvent`'s switch, (3) decide what the handler actually does
  on receipt (push staged attachments, update `erpSyncStatus` for a purchase that was synced
  fire-and-forget rather than awaited).

`DashboardPurchasesApplicationService.syncToErp()` (`sync2books-compliance-api/src/dashboard-purchases/application/dashboard-purchases.application.service.ts`)
was a deliberate stub before this pass:

```ts
syncToErp(_complianceTenantId: string, ids: string[]): never {
  throw new BadRequestException(
    'ERP sync for purchase invoices is not available yet. Coming soon.',
  );
}
```

This doc records the decision on *what* a synced purchase becomes on the ERP side, and scopes
the work to replace the stub. It does not cover KRA confirmation (`confirm()`, fully built and
unrelated — see the method's own doc comment) or eTIMS currency conversion (a separate,
already-tracked gap, see "Out of scope" below).

## Decision

**Every purchase synced to an ERP becomes a Bill (Accounts Payable), never a QuickBooks-style
one-step Expense/Purchase — until KRA's purchase data is confirmed to carry a payment-method
signal, at which point a cash/already-paid branch can be added.**

### Why

- KRA's OSCU purchase-fetch payload gives us no cash-vs-credit signal today.
  `PurchaseInvoiceOrmEntity` has no payment-type column, and `rawKraResponse` (the raw
  `saleList[]` record kept for audit) has not been confirmed to carry one either — `pmtTyCd`
  exists extensively in this codebase, but only on the *sales* side
  (`oscu-sales-request.builder.ts`, `sales.service.ts`'s `paymentTypeDescription()`). Positing
  a purchase as "already paid" without that signal would misstate the business's AP position.
- The entity's own doc comment already assumes this: `PurchaseInvoiceOrmEntity.supplierId`'s
  comment reads *"Null means unmatched: no Supplier record exists yet for this counterparty,
  so this purchase can't be synced back to an ERP **as a Bill** until one does"* — Bill was
  already the implicit target when that field was designed.
- Across the three ERPs this codebase (or its docs) reference, Bill is the only universal
  concept:
  - **QuickBooks** has a genuine one-step "Purchase"/Expense object (bank/card outflow +
    expense account + tax line, no AP) — this is the exception, not the norm. Both
    `BillService.createBill()` (`nest-sync-2-books-api/src/bill/...`) and a QBO-specific
    `createExpense()` (`quickbook.service.ts:320`) exist.
  - **Odoo** has no equivalent object. `OdooService.createExpense()`
    (`odoo.service.ts:480`) *is* `createBill()` (`account.move`, `move_type: 'in_invoice'`)
    immediately followed by `account.payment.register` to fully pay it — confirmed in
    [[project-odoo-integration-status]]. "Paid at purchase" is a Bill settled in the same
    transaction, not a distinct document type.
  - **Dynamics 365 Business Central** (general accounting knowledge, not verified against this
    codebase's Dynamics connector code) follows the same pattern as Odoo: every vendor
    purchase is a Purchase Invoice against the Vendor Ledger; a cash purchase is a Purchase
    Invoice posted and immediately fully applied via a Payment Journal entry, not a separate
    object.
- "Bill Payment" was considered and rejected as the sync target by itself — it isn't a
  standalone document in any of these systems, only ever step 2 against an existing Bill/AP
  entry. There is nothing to attach it to unless a Bill already exists.

### Consequences

- A synced purchase always creates an AP liability in the target ERP, even if the business
  actually paid cash at the counter. That's the conservative failure mode (never claims money
  left the business without evidence) — the alternative (defaulting to paid) risks the books
  understating what's owed and overstating cash spent.
- The user resolves "actually this was paid" manually in the ERP itself (mark the Bill paid),
  same as they would for any vendor bill entered by hand, until Phase "cash-purchase branch"
  below is built.
- If/when a payment-type signal is confirmed to exist on the KRA purchase payload, the fix is
  additive: branch to QuickBooks' `POST /bills/with-payment` or Odoo's `createExpense()`
  instead of `POST /bills` — no rework of the Bill path itself.

## Current state (verified against code, 2026-08-26)

| Piece | Status |
|---|---|
| `dashboard_purchase_invoices.erpSyncStatus` column | **Exists** (`'not_synced' \| 'synced' \| 'sync_failed'`), just never written to besides the initial default |
| `dashboard_purchase_invoices.supplierId` | Exists, nullable — auto-matched by TIN on pull, or via `linkSupplier`/create-supplier flows |
| Push path from compliance-api → main-api | **Does not exist.** `MainApiPullClient` (`sync2books-compliance-api/src/integration/main-api-pull/infrastructure/http/main-api-pull.client.ts`, 827 lines) has `getItems`/`getInvoices`/`getSuppliers`/etc. (pull) and `syncXFromBookkeeping` (trigger-a-pull), but no `createBill`/`createExpense`/`createAttachment` — every existing method reads from main-api, none writes to it. |
| `POST /bills` and `POST /bills/with-payment` | **Already exist and work** in `nest-sync-2-books-api` (`src/bill/controllers/bill.controller.ts:18,36`), API-key authenticated, ERP-agnostic (dispatches on the connection's `integrationKey` inside `BillService`/the sync engine — ​Bill already had Odoo parity before this session's Invoice/Expense/BillPayment work, per [[project-odoo-integration-status]]'s parity table). |
| Attachments | Generic, working handlers for both QuickBooks and Odoo exist in `nest-sync-2-books-api/src/attachment/`, but the upload endpoint is scoped `POST /connections/:connectionId/syncs/:syncId/transactions/:transactionId/attachments` — it needs an existing sync batch/item, not just a bill id. Neither `Invoice` nor `PurchaseInvoiceOrmEntity` has an attachments field today. |
| Payment-type field on purchases | **Does not exist.** `pmtTyCd`/payment-method is only wired on the sales side. |

## Implementation status

### Phase 0 — resolved

1. **Payment-type field: exists, unread.** `pmtTyCd` ("Payment Type Code") is documented in
   the OSCU spec §3.3.7 ("Purchase Information", `TrnsPurchaseSalesReq/Res`) and appears in its
   sample payload (`"pmtTyCd":"01"`). It sits unread inside `record` in `upsertFromKraRecord` —
   now captured into the new `paymentTypeCode` column (below), but **not acted on**: the
   cash-purchase branch is still deferred, see "Out of scope" — capturing the field and
   building the branch are two different pieces of work, and only the former shipped this pass.
2. **Supplier ERP-side id: `dashboard_suppliers.externalId` was the wrong field.** It stores
   main API's own `Supplier.id` (its internal PK), not the ERP's own vendor id that
   `CreateBillDto.supplierRef.id` needs (main API's `Supplier.bookId` — confirmed by
   `toOdooSupplierUpdate()`/`toQuickBooksSupplierUpdate()` casting `bookId` to the Odoo/QBO
   vendor id). Fixed by adding a `bookId` field to `MainApiSupplier` (it was already returned
   by `GET /suppliers` — `supplier-list-response.dto.ts` — just never typed/read on this side)
   and a new `dashboard_suppliers.bookId` column, populated in `pullSuppliers()`.
3. **`POST /bills`'s response does carry what attachments need, but there's a race.**
   `BillService.createBill()` is genuinely queue-first: it returns
   `{ bill, syncBatchId, syncedToBookkeeping: false }` synchronously, then fires
   `syncService.processSyncBatch()` **unawaited**. `syncBatchId` maps to `:syncId` and
   `bill.id` maps to `:transactionId` for the attachments route — no separate lookup needed —
   but `AttachmentService.createAttachmentFromSync` requires the sync item's status to already
   be `'synced'`, which it won't be immediately after `POST /bills` returns. Attachments (Phase
   3, still unbuilt) will need to poll sync status first.
4. **compliance-api has no migrations** — `synchronize: true`, no `src/migrations/` dir, no
   TypeORM CLI datasource. New columns just needed adding as `@Column(...)` properties; TypeORM
   ALTERs the table on next boot. Done.

### Phase 1 — main-api: two real pre-existing bugs found and fixed

`POST /bills` was **completely broken**, not just untested — both bugs below meant every call
to it, ever, would have thrown:

1. **`BillController.createBill`/`getBills`/`updateBill` read `req.user.connectionId` /
   `req.user.companyId` / `req.user.applicationId`, but `ApiKeyAuthGuard` never sets
   `req.user`** — it sets `request['application']`, read elsewhere via the `@ApplicationContext()`
   decorator. Confirmed via grep: `req.user` is assigned nowhere in this codebase's `src/`, and
   no middleware populates it either. Every call would throw
   `TypeError: Cannot destructure property 'connectionId' of 'req.user' as it is undefined`
   before reaching the service layer.

   **Fixed** (scoped to `createBill` only — the method this plan actually depends on;
   `getBills`/`updateBill`/`createBillWithPayment` have the same bug and were deliberately left
   as-is, see below): `BillController.createBill` now takes `:connectionId` as a URL param and
   `@ApplicationContext()` for `applicationId`, matching `ExpenseController`'s established
   pattern exactly. Route changed from `POST /bills` to `POST /bills/:connectionId` — not a
   breaking change in practice, since no caller could have successfully hit the old route.
   `BillService.createBill()`'s signature dropped its redundant, always-wrong `companyId`
   parameter — it now derives `companyId` from `connectionEntity.company.id` (the connection it
   already fetches), matching the `.company` relation TypeORM actually loads (not `.companyId`,
   which doesn't exist on `ConnectionEntity` — it's a `@ManyToOne` relation property, confirmed
   via `tsc`).

2. **`createBillWithPayment` cannot work as written — separate bug, fixed 2026-08-26.** It called
   `createBill()` then checked `billResult.syncedToBookkeeping !== true` to decide whether to
   proceed — but `createBill()` always returned `syncedToBookkeeping: false` synchronously (the
   real sync happens async, unawaited). This check would *always* fail, so `POST
   /bills/with-payment` always threw immediately after creating the bill. This plan's
   `syncToErp()` never called this endpoint (Bill-only, per the Decision above), so it was out of
   the dependency path at the time, but it directly blocks the future cash-purchase branch (see
   "Out of scope" below), so it was fixed anyway rather than left for whoever picks that up.

   **Fix**: `BillService.createBill()` gained an `awaitSync` param (default `false`, so the
   existing fire-and-forget `POST /bills` path is unchanged). `processSyncBatch()` has no queue
   behind it — it calls the ERP directly and its returned `Promise` resolves once that call is
   done — so `awaitSync: true` just awaits it instead of firing-and-forgetting, then re-fetches
   the bill via `GetBillByIdUseCase` to read back the real `syncStatus`/`bookId` that
   `BillSyncHandler` writes on success. `createBillWithPayment()` now passes `awaitSync: true`.
   Also had the same `req.user` bug as item 1 above (never fixed alongside it) — same fix
   applied: route is now `POST /bills/with-payment/:connectionId`, and `companyId` (needed for
   the payment step) is derived from the connection the same way `createBill()` does, dropping
   the redundant/broken `companyId` param from `createBillWithPayment()`'s signature too.
   Covered by 5 new cases in `bill.service.spec.ts` (sync-then-pay success, bill-sync-failure
   short-circuit, payment-failure-after-successful-bill-sync warning path, and the two
   connection-lookup failure modes).

Tests added: `nest-sync-2-books-api/src/bill/application/bill.service.spec.ts` (4 cases,
covering the companyId-derivation fix and its failure modes — no test existed for `BillService`
or `BillController` before this pass).

### Phase 2 — compliance-api: push client + `syncToErp()` — done

1. `MainApiPullClient.createBill()` added, following the existing `postJson<T>` pattern.
   Request/response types (`MainApiCreateBillRequest`/`MainApiCreateBillLineItem`/
   `MainApiCreateBillResponse`) mirror `CreateBillDto`, trimmed to the fields this repo
   populates. `MainApiSupplier.bookId` added (see Phase 0.2).
2. `syncToErp()` implemented on `DashboardPurchasesApplicationService`: guards
   (`confirmationStatus === 'confirmed'`, `supplierId` resolved, supplier has a `bookId`,
   tenant has a connected integration), builds the Bill payload (`currency: 'KES'` — see "Out
   of scope"), calls `createBill()`, and updates `erpSyncStatus`/`erpBillId`/`erpSyncBatchId`/
   `erpSyncError`/`erpSyncedAt` per-row — failures on one row don't abort the batch, mirroring
   `confirm()`'s existing per-row error-collection pattern. Already-`synced` rows are skipped,
   not re-pushed.
3. New columns on `PurchaseInvoiceOrmEntity`: `paymentTypeCode`, `erpBillId`, `erpSyncBatchId`,
   `erpSyncError`, `erpSyncedAt`. `upsertFromKraRecord` now captures `pmtTyCd` into
   `paymentTypeCode` (unread by sync logic, see Phase 0.1). `PurchaseInvoiceDto` gained
   `erpSyncError` (a small slice of Phase 4, shipped early since it was cheap).
4. `DashboardPurchasesController`'s `POST /purchases/sync-to-erp` now awaits and returns the
   real result instead of firing-and-forgetting a method that always threw.

Tests added: `dashboard-purchases.syncToErp.spec.ts` (7 cases — success, no connected
integration, unconfirmed purchase, unlinked supplier, supplier without a `bookId`, already-
synced skip, and a failed push recording the error without throwing).

Both services: `tsc --noEmit` clean, full existing suites still green (257/257 in main-api,
168/168 in compliance-api including the 11 new cases above).

### Phase 3 — attachments (not built)

1. Add an attachments relation to the purchase invoice (new join table or a JSON column,
   consistent with whatever `nest-sync-2-books-api`'s own `AttachmentEntity` shape implies).
2. Add an upload endpoint on the purchases controller (multer, same shape as
   `nest-sync-2-books-api`'s `AttachmentController`). Per the original ask: allow upload once
   `confirmationStatus === 'confirmed'`, **not** gated behind `erpSyncStatus === 'synced'** —
   so a user can attach supporting docs before or independent of the ERP push.
3. On `syncToErp()` success (or as an explicit follow-up call once Phase 0.3 clarifies timing),
   push any staged attachments through the existing
   `POST /connections/:connectionId/syncs/:syncId/transactions/:transactionId/attachments`
   endpoint, using the sync identifiers from the Bill just created — so the file lands on the
   same Bill record in Odoo/QuickBooks, not floating unattached.

### Phase 4 — surface it (partially done)

- ~~Extend `PurchaseInvoiceDto` with `erpSyncError`~~ — done as part of Phase 2, since it was a
  one-line addition on top of the same DTO/mapper work.
- Still open: an attachments list on the DTO (blocked on Phase 3), and a retry/re-sync path for
  `sync_failed` rows (same UX shape as KRA confirmation retries — currently a caller can just
  re-`POST /purchases/sync-to-erp` the same ids, since `syncToErp()` re-attempts anything not
  already `'synced'`, but there's no dedicated retry endpoint/button).

## Open questions / risks

- Phase 3 (sync id timing) will force attachments into a two-step "sync bill, wait for synced,
  then upload" UX rather than "upload alongside sync", per Phase 0.3's finding above — the race
  is real, not hypothetical.
- ~~`createBillWithPayment`'s broken synchronous-completion check (Phase 1, item 2) blocks the
  cash-purchase branch whenever it gets picked up — fix that bug first, don't rediscover it.~~
  Fixed 2026-08-26, see Phase 1 item 2.

## Out of scope

- **Cash-purchase (Expense) branch** — `pmtTyCd` is now captured (Phase 0.1/2) but not acted
  on; building the branch itself is still deferred, and additionally now blocked on the
  `createBillWithPayment` bug noted above.
- **Currency conversion** — already tracked separately in [[project-etims-currency-gap]].
  This plan inherits the same KES-only assumption already implicit everywhere else in the
  purchase pipeline; don't treat that as a new gap introduced here.
- **Dynamics 365** — `MainApiIntegrationKey` (`main-api-pull.client.ts`) lists
  `'microsoft-dynamics-365-business-central'`, and `listDynamicsCompanies`/
  `finalizeDynamicsConnection` exist, so *connection setup* clearly supports it — but whether
  `BillService.createBill()` actually dispatches to a working Dynamics handler the same way it
  does for QuickBooks/Odoo has not been verified for this plan. Confirm before assuming this
  plan covers all three ERPs equally.
