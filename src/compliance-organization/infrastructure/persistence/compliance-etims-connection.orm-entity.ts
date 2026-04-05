import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ComplianceBranchOrmEntity } from './compliance-branch.orm-entity';

@Entity('compliance_etims_connections')
export class ComplianceEtimsConnectionOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @OneToOne(() => ComplianceBranchOrmEntity, (b) => b.etimsConnection, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'complianceBranchId' })
  branch!: ComplianceBranchOrmEntity;

  @Column('varchar', { nullable: true })
  sync2booksConnectionId!: string | null;

  @Column('varchar')
  kraPin!: string;

  /**
   * OSCU device id returned from initialize (`dvcId` in `selectInitOsdcInfo` / `data.info`).
   * Used as device identifier on subsequent eTIMS calls.
   */
  @Column('varchar')
  deviceId!: string;

  /**
   * Device serial sent in the initialize request body (`dvcSrlNo`).
   * Distinct from {@link deviceId} (OSCU-assigned `dvcId` after init).
   */
  @Column('varchar', { nullable: true })
  dvcSrlNo!: string | null;

  @Column('varchar')
  cmcKey!: string;

  @Column('varchar')
  environment!: string;

  @Column('varchar')
  status!: string;

  @Column('datetime', { nullable: true })
  lastCodeSyncAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
