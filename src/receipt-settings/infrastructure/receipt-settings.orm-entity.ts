import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { ReceiptSettingsData } from '../domain/receipt-settings.model';

/**
 * One row per business (compliance tenant). `tenantId` is the primary key, so a
 * business can only ever have one row and every read/write is by that key.
 * The logo bytes live here (never selected by default) and are only served
 * through ReceiptSettingsService, which is always called with the caller's own
 * verified tenant id.
 */
@Entity('receipt_settings')
export class ReceiptSettingsOrmEntity {
  @PrimaryColumn('varchar')
  tenantId!: string;

  @Column('simple-json')
  settings!: ReceiptSettingsData;

  @Column('varchar', { nullable: true })
  logoMime!: string | null;

  @Column('int', { nullable: true })
  logoSize!: number | null;

  @Column('varchar', { length: 64, nullable: true })
  logoSha256!: string | null;

  @Column({ type: 'longblob', nullable: true, select: false })
  logoContent!: Buffer | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
