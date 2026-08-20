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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
