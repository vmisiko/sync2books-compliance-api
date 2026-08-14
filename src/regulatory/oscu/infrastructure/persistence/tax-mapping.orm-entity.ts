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

@Entity('tax_mappings')
@Index(['merchantId', 'internalTaxCategory', 'active'], { unique: true })
export class TaxMappingOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar', { nullable: true })
  merchantId!: string | null;

  @Column('varchar')
  internalTaxCategory!: string;

  @Column('varchar')
  taxTyCd!: string;

  @Column('int', { default: 1 })
  version!: number;

  @Column('boolean', { default: true })
  active!: boolean;

  // --- Mapping Center dashboard fields (additive; unused by
  // ClassificationResolverTypeOrm, which only reads the columns above) ---

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

  /** Raw label as it appeared in the source system, e.g. "16% Standard VAT". */
  @Column('varchar', { nullable: true })
  externalValue!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
