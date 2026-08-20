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

  @Column('varchar', { nullable: true })
  mainApiOrganizationId!: string | null;

  @Column('varchar', { nullable: true })
  mainApiApplicationId!: string | null;

  @Column('varchar', { nullable: true })
  mainApiApiKey!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
