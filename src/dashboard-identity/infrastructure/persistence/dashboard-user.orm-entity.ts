import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DashboardRole } from '../../../shared/domain/enums/dashboard-role.enum';

@Entity('dashboard_users')
export class DashboardUserOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Index({ unique: true })
  @Column('varchar')
  email!: string;

  @Column('varchar')
  passwordHash!: string;

  @Column('varchar', { nullable: true })
  displayName!: string | null;

  @Column('varchar')
  role!: DashboardRole;

  @Column('varchar')
  complianceTenantId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
