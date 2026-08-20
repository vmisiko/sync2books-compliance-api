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

  @Column('varchar', { nullable: true })
  passwordHash!: string | null;

  @Column('varchar', { nullable: true })
  displayName!: string | null;

  @Column('varchar')
  role!: DashboardRole;

  @Column('varchar')
  organizationId!: string;

  @Column('varchar', { nullable: true })
  status!: string | null;

  @Column('varchar', { nullable: true })
  oauthProvider!: string | null;

  @Column('varchar', { nullable: true })
  oauthSubject!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
