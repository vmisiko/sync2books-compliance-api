import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('dashboard_customers')
export class CustomerOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  @Index()
  merchantId!: string;

  /** Main-API customer id (bookId), when this row was pulled from an ERP rather than added manually. */
  @Column('varchar', { nullable: true })
  @Index()
  externalId!: string | null;

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
