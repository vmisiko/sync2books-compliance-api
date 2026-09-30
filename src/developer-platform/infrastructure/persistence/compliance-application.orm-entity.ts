import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ComplianceApplicationStatus } from '../../domain/entities/compliance-application.entity';

@Entity('compliance_applications')
export class ComplianceApplicationOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Index()
  @Column('varchar')
  organizationId!: string;

  @Column('varchar')
  name!: string;

  @Column('varchar', { nullable: true })
  description!: string | null;

  @Column('varchar', { default: 'active' })
  status!: ComplianceApplicationStatus;

  @Column('int', { default: 120 })
  rateLimitPerMin!: number;

  @Column('varchar', { nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
