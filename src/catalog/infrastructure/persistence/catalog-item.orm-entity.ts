import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('catalog_items')
export class CatalogItemOrmEntity {
  @PrimaryColumn()
  id!: string;

  @Column()
  merchantId!: string;

  @Column({ type: 'varchar', nullable: true })
  externalId!: string | null;

  @Column()
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  sku!: string | null;

  @Column({ type: 'varchar' })
  itemType!: string;

  @Column({ type: 'varchar' })
  taxCategory!: string;

  @Column()
  classificationCode!: string;

  @Column()
  unitCode!: string;

  @Column({ type: 'varchar', default: 'NT' })
  packagingUnitCode!: string;

  @Column({ type: 'varchar', default: 'B' })
  taxTyCd!: string;

  @Column({ type: 'varchar', default: '2' })
  productTypeCode!: string;

  @Column({ type: 'float', nullable: true })
  unitPrice!: number | null;

  @Column({ type: 'varchar', nullable: true, default: 'KE' })
  originCountry!: string | null;

  @Column({ type: 'boolean', default: false })
  isStockItem!: boolean;

  @Column({ type: 'varchar', default: 'PENDING' })
  registrationStatus!: 'PENDING' | 'REGISTERED' | 'FAILED';

  @Column({ type: 'varchar', nullable: true })
  etimsItemCode!: string | null;

  @Column({ type: 'varchar', nullable: true })
  lastSyncResultCd!: string | null;

  @Column({ type: 'varchar', nullable: true })
  lastSyncResultMsg!: string | null;

  @Column({ type: 'datetime', nullable: true })
  lastSyncAttemptAt!: Date | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'datetime', nullable: true })
  lastSyncedAt!: Date | null; // SQLite stores as ISO string

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /** Pattern 2 headers from Main API (for `POST .../oscu-outcome` retries). */
  @Column({ type: 'json', nullable: true })
  sync2booksCorrelation!: Record<string, unknown> | null;

  /**
   * The ERP this item was pulled from (e.g. QUICKBOOKS, ODOO,
   * MICROSOFT_DYNAMICS_365_BUSINESS_CENTRAL — see SourceSystem enum), or
   * null for a manually-created item / an item pulled before this field
   * existed. Mirrors CustomerOrmEntity.sourceSystem.
   */
  @Column('varchar', { nullable: true })
  sourceSystem!: string | null;
}
