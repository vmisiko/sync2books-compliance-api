import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type PurchaseAttachmentErpPushStatus =
  | 'not_pushed'
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'failed';

/**
 * A supplier document (PDF/JPG/PNG) uploaded against a purchase invoice. Bytes
 * live in `content` (never selected by default); every read goes through
 * `PurchaseAttachmentService`, which resolves the invoice by merchant first.
 */
@Entity('purchase_invoice_attachments')
@Index(['merchantId', 'purchaseInvoiceId'])
export class PurchaseInvoiceAttachmentOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar')
  merchantId!: string;

  @Column('varchar')
  purchaseInvoiceId!: string;

  @Column('varchar')
  filename!: string;

  @Column('varchar')
  mime!: string;

  @Column('int')
  size!: number;

  @Column('varchar', { length: 64 })
  sha256!: string;

  @Column({ type: 'longblob', select: false })
  content!: Buffer;

  @Column('varchar', { default: 'not_pushed' })
  erpPushStatus!: PurchaseAttachmentErpPushStatus;

  /**
   * The user marked this file "send to the ERP bill". It is sent whenever the invoice's bill is
   * created or re-synced (and immediately if the bill already exists). Null on rows created
   * before the column existed -- treat as false.
   */
  @Column('boolean', { default: false, nullable: true })
  attachToErp!: boolean | null;

  @Column('text', { nullable: true })
  erpPushError!: string | null;

  @Column('varchar', { nullable: true })
  erpAttachmentId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
