import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('compliance_tenants')
export class ComplianceTenantOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar', { unique: true, nullable: true })
  sync2booksCompanyId!: string | null;

  @Column('varchar', { nullable: true })
  displayName!: string | null;

  @Column('varchar', { nullable: true })
  organizationId!: string | null;

  /** Commercial message above the item list (TIS page 8 sample: "Welcome to our shop"). Null falls back to a generic default at render time. */
  @Column('varchar', { nullable: true })
  receiptHeaderMessage!: string | null;

  /** Commercial message in the footer (TIS page 8 sample: "THANK YOU ..."). Null falls back to a generic default at render time. */
  @Column('varchar', { nullable: true })
  receiptFooterMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
