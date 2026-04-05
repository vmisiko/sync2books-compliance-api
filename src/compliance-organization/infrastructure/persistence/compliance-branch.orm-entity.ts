import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ComplianceTenantOrmEntity } from './compliance-tenant.orm-entity';
import { ComplianceEtimsConnectionOrmEntity } from './compliance-etims-connection.orm-entity';

@Entity('compliance_branches')
@Unique(['tenantId', 'sync2booksBranchId'])
export class ComplianceBranchOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  @Index()
  tenantId!: string;

  @ManyToOne(() => ComplianceTenantOrmEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: ComplianceTenantOrmEntity;

  @Column('varchar', { nullable: true })
  sync2booksBranchId!: string | null;

  @Column('varchar', { nullable: true })
  displayName!: string | null;

  @Column('varchar', { nullable: true })
  kraBhfId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToOne(() => ComplianceEtimsConnectionOrmEntity, (c) => c.branch)
  etimsConnection!: ComplianceEtimsConnectionOrmEntity | null;
}
