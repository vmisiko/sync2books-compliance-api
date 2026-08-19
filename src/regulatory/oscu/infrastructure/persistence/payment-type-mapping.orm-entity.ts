import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SourceSystem } from '../../../../shared/domain/enums/source-system.enum';
import { MappingStatus } from '../../../../shared/domain/enums/mapping-status.enum';

@Entity('payment_type_mappings')
@Index(['merchantId', 'internalPaymentMethod', 'active'], { unique: true })
export class PaymentTypeMappingOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar', { nullable: true })
  merchantId!: string | null;

  /** Null for a pulled external payment method with no confident auto-suggestion (status UNMAPPED) — a human fills this in via PATCH dashboard-api/mappings/:id. */
  @Column('varchar', { nullable: true })
  internalPaymentMethod!: string | null;

  /** OSCU pmtTyCd (code classification 07). Null alongside internalPaymentMethod for the same UNMAPPED reason. */
  @Column('varchar', { nullable: true })
  pmtTyCd!: string | null;

  @Column('int', { default: 1 })
  version!: number;

  @Column('boolean', { default: true })
  active!: boolean;

  // --- Mapping Center dashboard fields (additive; unused by
  // PaymentTypeResolverTypeOrm, which only reads the columns above) ---

  /** Which ERP this row's suggestion/value came from; null for global defaults and pre-existing rows. */
  @Column('varchar', { nullable: true })
  sourceSystem!: SourceSystem | null;

  /** Review-workflow status. Existing global-default rows default to MAPPED (they are already in effect). */
  @Column('varchar', { default: MappingStatus.MAPPED })
  status!: MappingStatus;

  /** 0-100 auto-suggestion confidence; null for manually-entered or pre-existing rows. */
  @Column('int', { nullable: true })
  confidenceScore!: number | null;

  /** Dashboard user (email) who approved/edited this mapping. */
  @Column('varchar', { nullable: true })
  approvedBy!: string | null;

  @Column('datetime', { nullable: true })
  approvedAt!: Date | null;

  /** Raw label as it appeared in the source system, e.g. QuickBooks PaymentMethod.Name "M-Pesa". */
  @Column('varchar', { nullable: true })
  externalValue!: string | null;

  /** The source system's raw id for this row (e.g. a QuickBooks PaymentMethod id) — lets a re-pull find and refresh this exact row (including an UNMAPPED one) instead of creating a duplicate. Null for manually-created rows. */
  @Column('varchar', { nullable: true })
  externalId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
