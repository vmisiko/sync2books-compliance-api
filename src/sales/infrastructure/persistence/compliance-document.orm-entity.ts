import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('compliance_documents')
export class ComplianceDocumentOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  @Index()
  merchantId!: string;

  @Column('varchar')
  branchId!: string;

  @Column('varchar')
  sourceSystem!: string;

  @Column('varchar')
  sourceDocumentId!: string;

  @Column('varchar')
  documentType!: string;

  @Column('varchar')
  documentNumber!: string;

  @Column('varchar')
  currency!: string;

  @Column('float')
  exchangeRate!: number;

  @Column('float')
  subtotalAmount!: number;

  @Column('float')
  totalAmount!: number;

  @Column('float')
  totalTax!: number;

  @Column('varchar', { nullable: true })
  customerPin!: string | null;

  @Column('varchar')
  complianceStatus!: string;

  @Column('int')
  submissionAttempts!: number;

  @Column('varchar', { nullable: true })
  etimsReceiptNumber!: string | null;

  @Column('varchar')
  @Index({ unique: true })
  idempotencyKey!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column('datetime', { nullable: true })
  submittedAt!: Date | null;
}
