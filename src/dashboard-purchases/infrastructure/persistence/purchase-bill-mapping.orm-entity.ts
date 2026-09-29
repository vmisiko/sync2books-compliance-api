import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PurchaseBillMappingKind = 'expense_account' | 'tax';

/**
 * How a confirmed purchase becomes a vendor Bill in the tenant's ERP: the
 * account every bill line posts to, and the ERP tax each KRA tax type
 * (A–E) is written as. Set in the Mapping Center's Purchase Bills tab and
 * read by `syncToErp()`.
 *
 * Keyed by `integrationKey` as well as merchant because every `erpId` is an
 * id in that ERP's own id space (a QuickBooks Account Id means nothing to
 * Odoo) — reconnecting a different ERP starts from an empty mapping rather
 * than silently posting to a wrong account.
 */
@Entity('dashboard_purchase_bill_mappings')
@Index(['merchantId', 'integrationKey', 'kind', 'taxTyCd'], { unique: true })
export class PurchaseBillMappingOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Lengths are explicit because the four columns form one unique index,
  // which must fit MySQL's 3072-byte key limit under utf8mb4.
  @Column('varchar', { length: 64 })
  merchantId!: string;

  /** quickbooks | odoo | microsoft-dynamics-365-business-central */
  @Column('varchar', { length: 64 })
  integrationKey!: string;

  @Column('varchar', { length: 32 })
  kind!: PurchaseBillMappingKind;

  /** KRA tax type letter for `tax` rows; '' for the `expense_account` row (MySQL unique indexes treat NULLs as distinct). */
  @Column('varchar', { length: 8, default: '' })
  taxTyCd!: string;

  /** The ERP's own id — sent as the bill line's accountRef.id / taxRateRef.id. */
  @Column('varchar')
  erpId!: string;

  @Column('varchar')
  erpName!: string;

  /** Dashboard user (email) who last saved this row. */
  @Column('varchar', { nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
