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

  @Column('timestamp')
  pulledAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
