import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('dashboard_organizations')
export class DashboardOrganizationOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  displayName!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
