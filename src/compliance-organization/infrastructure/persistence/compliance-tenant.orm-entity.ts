import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('compliance_tenants')
export class ComplianceTenantOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar', { unique: true, nullable: true })
  @Index()
  sync2booksCompanyId!: string | null;

  @Column('varchar', { nullable: true })
  displayName!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
