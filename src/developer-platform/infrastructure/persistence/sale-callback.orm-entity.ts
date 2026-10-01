import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  SaleCallbackEvent,
  SaleCallbackStatus,
} from '../../domain/sale-callback';

@Entity('sale_callbacks')
@Index(['status', 'nextAttemptAt'])
export class SaleCallbackOrmEntity {
  @PrimaryColumn('varchar')
  documentId!: string;

  @Index()
  @Column('varchar')
  merchantId!: string;

  @Column('varchar', { length: 2048 })
  url!: string;

  @Column('varchar', { default: 'awaiting_outcome' })
  status!: SaleCallbackStatus;

  @Column('varchar', { nullable: true })
  event!: SaleCallbackEvent | null;

  @Column('varchar', { nullable: true })
  outcomeKey!: string | null;

  @Column('json', { nullable: true })
  payload!: Record<string, unknown> | null;

  @Column('int', { default: 0 })
  attempts!: number;

  // Millisecond precision matters here: a whole-second column rounds `now`
  // up, and the claim's `nextAttemptAt <= now` then misses the immediate
  // delivery attempt (seen live: 07:42:01.894 stored as 07:42:02).
  @Column('datetime', { precision: 3, nullable: true })
  nextAttemptAt!: Date | null;

  @Column('datetime', { precision: 3, nullable: true })
  lastAttemptAt!: Date | null;

  @Column('int', { nullable: true })
  lastResponseStatus!: number | null;

  @Column('varchar', { length: 500, nullable: true })
  lastError!: string | null;

  @Column('datetime', { precision: 3, nullable: true })
  deliveredAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
