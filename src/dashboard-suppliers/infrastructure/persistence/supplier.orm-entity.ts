import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('dashboard_suppliers')
@Index(['merchantId', 'tin'])
export class SupplierOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  @Index()
  merchantId!: string;

  /** Main-API supplier id (main API's own record id), when this row was pulled from an ERP rather than added manually. Not the ERP's own id — see `bookId`. */
  @Column('varchar', { nullable: true })
  @Index()
  externalId!: string | null;

  /** The ERP's own supplier/vendor id (QuickBooks Vendor Id / Odoo `res.partner` id) — what a Bill push's `supplierRef.id` must use, distinct from `externalId` above. Null until a pull populates it. */
  @Column('varchar', { nullable: true })
  bookId!: string | null;

  @Column('varchar')
  name!: string;

  @Column('varchar', { nullable: true })
  tin!: string | null;

  @Column('varchar', { nullable: true })
  phoneNumber!: string | null;

  @Column('varchar', { nullable: true })
  email!: string | null;

  /** ERP provenance (SourceSystem enum value, e.g. QUICKBOOKS/ODOO), when pulled from an ERP rather than added manually. */
  @Column('varchar', { nullable: true })
  sourceSystem!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
