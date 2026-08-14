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
  mainApiCompanyId!: string | null;

  /**
   * Record<integrationKey, {connectionId,status,reason,updatedAt}> — updatedAt
   * persisted as an ISO string (JSON round-tripping doesn't revive Dates);
   * the repository mapper converts to/from Date at the domain boundary.
   */
  @Column('simple-json', { nullable: true })
  integrations!: Record<
    string,
    {
      connectionId: string | null;
      status: string | null;
      reason: string | null;
      updatedAt: string | null;
    }
  > | null;

  @Column('varchar', { nullable: true })
  webhookEndpointId!: string | null;

  @Column('varchar', { nullable: true })
  webhookSecret!: string | null;

  @Column('varchar', { nullable: true })
  lastWebhookEventId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
