import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PurchaseConfirmationStatus =
  | 'pulled'
  | 'pending_review'
  | 'confirmed'
  | 'rejected';

export type PurchaseErpSyncStatus = 'not_synced' | 'synced' | 'sync_failed';

export type PurchaseLineItemJson = {
  id: string;
  description: string;
  hsCode: string;
  qty: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  total: number;
};

/**
 * Locally-persisted view of a supplier invoice confirmed via KRA OSCU's
 * `getPurchaseTransactionInfo` ("When a seller registers sales transaction
 * and Invoice data to eTIMS Server, buyer can request such data for
 * purchase confirmation" — see oscu-payload-gotchas.md). KRA itself keeps
 * no record of *our* review state (pending/confirmed/rejected) — that
 * workflow only exists here, upserted by supplier TIN + supplier invoice
 * number on every pull so re-pulling never clobbers a reviewer's decision.
 */
@Entity('dashboard_purchase_invoices')
@Index(['merchantId', 'spplrTin', 'spplrInvcNo'])
export class PurchaseInvoiceOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar')
  @Index()
  merchantId!: string;

  @Column('varchar', { nullable: true })
  branchId!: string | null;

  @Column('varchar', { nullable: true })
  branchName!: string | null;

  @Column('varchar', { nullable: true })
  kraBhfId!: string | null;

  /** Supplier's KRA PIN (`spplrTin`) — doubles as the Input VAT eligibility check. */
  @Column('varchar', { nullable: true })
  spplrTin!: string | null;

  /** Supplier's own invoice number (`spplrInvcNo`), as confirmed via KRA. */
  @Column('varchar', { nullable: true })
  spplrInvcNo!: string | null;

  @Column('varchar')
  supplierName!: string;

  @Column('varchar')
  supplierPin!: string;

  /**
   * FK (app-level, no DB constraint) to dashboard_suppliers.id, once this
   * purchase's spplrTin has been matched -- either automatically on pull
   * (exact-TIN match against an existing Supplier) or manually via
   * link-supplier/create-supplier. Null means "unmatched": no Supplier
   * record exists yet for this counterparty, so this purchase can't be
   * synced back to an ERP as a Bill until one does.
   */
  @Column('varchar', { nullable: true })
  @Index()
  supplierId!: string | null;

  /** Display code for the eTIMS Receipt No column — currently the supplier's invoice number. */
  @Column('varchar')
  receiptNo!: string;

  /** ISO date string. */
  @Column('varchar')
  invoiceDate!: string;

  @Column('float')
  subtotal!: number;

  @Column('float')
  vat!: number;

  @Column('float')
  total!: number;

  @Column('varchar')
  confirmationStatus!: PurchaseConfirmationStatus;

  @Column('varchar')
  erpSyncStatus!: PurchaseErpSyncStatus;

  @Column('json')
  lineItems!: PurchaseLineItemJson[];

  /** Raw KRA `saleList[]` record for this invoice, kept for audit/debugging. */
  @Column('json', { nullable: true })
  rawKraResponse!: Record<string, unknown> | null;

  /**
   * `invcNo` reserved from the `purchase_confirm_seq:*` counter in
   * `oscu_sync_state` for this invoice's `sendPurchaseTransactionInfo` call.
   * Persisted so a retry after a transient/rejected send reuses the same
   * number instead of reserving a new one (mirrors `oscuInvcNo` on sales
   * documents). Cleared back to null when a permanent rejection releases
   * the number.
   */
  @Column('int', { nullable: true })
  kraConfirmInvcNo!: number | null;

  /** `resultCd` from the last `sendPurchaseTransactionInfo` attempt, e.g. '000' on success. */
  @Column('varchar', { nullable: true })
  kraConfirmResultCd!: string | null;

  /** Error/rejection message from the last `sendPurchaseTransactionInfo` attempt, if any. Cleared on success. */
  @Column('text', { nullable: true })
  kraConfirmError!: string | null;

  /** When KRA accepted the `sendPurchaseTransactionInfo` confirmation. */
  @Column('timestamp', { nullable: true })
  kraConfirmedAt!: Date | null;

  /**
   * KRA's `pmtTyCd` ("Payment Type Code", e.g. '01' = cash) off the raw purchase record, when
   * present — see PURCHASE_TO_ERP_SYNC_PLAN.md. Not currently read by anything: ERP sync always
   * posts a Bill regardless of this value until a cash-purchase branch is built.
   */
  @Column('varchar', { nullable: true })
  paymentTypeCode!: string | null;

  /** The Bill's local id in main API, once `syncToErp` succeeds — main API's own id, not the ERP's own bookId. */
  @Column('varchar', { nullable: true })
  erpBillId!: string | null;

  /** main API's `syncBatchId` for the Bill push, for a future retry/status-check flow. */
  @Column('varchar', { nullable: true })
  erpSyncBatchId!: string | null;

  /** Error message from the last failed `syncToErp` attempt. Cleared on success. */
  @Column('text', { nullable: true })
  erpSyncError!: string | null;

  /** When `syncToErp` last succeeded (queued the bill — not when the ERP write itself completes, which is async). */
  @Column('timestamp', { nullable: true })
  erpSyncedAt!: Date | null;

  @Column('timestamp')
  pulledAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
