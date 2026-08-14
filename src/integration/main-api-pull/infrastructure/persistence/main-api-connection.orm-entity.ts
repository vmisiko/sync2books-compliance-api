import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('main_api_connections')
export class MainApiConnectionOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Index({ unique: true })
  @Column('varchar')
  complianceTenantId!: string;

  @Column('varchar')
  mainApiApplicationId!: string;

  @Column('varchar')
  mainApiApiKey!: string;

  @Column('varchar', { nullable: true })
  quickbooksConnectionId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
