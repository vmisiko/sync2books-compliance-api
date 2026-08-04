import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Audit trail for raw OSCU pass-through calls (certification/testing operations without
 * their own domain table), e.g. branchInsuranceInfo, customerPinInfo, selectNoticeList.
 * Captures the exact request/response so KRA Go-Live evidence can be pulled back up later.
 */
@Entity('oscu_operation_logs')
export class OscuOperationLogOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar')
  @Index()
  operation!: string;

  @Column('varchar')
  @Index()
  merchantId!: string;

  @Column('varchar', { nullable: true })
  branchId!: string | null;

  @Column('varchar', { nullable: true })
  kraBhfId!: string | null;

  @Column('json', { nullable: true })
  requestBody!: Record<string, unknown> | null;

  @Column('boolean')
  success!: boolean;

  @Column('varchar', { nullable: true })
  resultCd!: string | null;

  @Column('text', { nullable: true })
  resultMsg!: string | null;

  @Column('json', { nullable: true })
  rawResponse!: Record<string, unknown> | null;

  @Column('text', { nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
