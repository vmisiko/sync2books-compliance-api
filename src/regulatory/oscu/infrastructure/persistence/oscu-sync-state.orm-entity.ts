import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('oscu_sync_state')
export class OscuSyncStateOrmEntity {
  @PrimaryColumn('varchar')
  syncKey!: string;

  @Column('varchar', { nullable: true })
  lastReqDt!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
