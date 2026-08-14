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

export type ClassificationMatchType = 'EXTERNAL_ID' | 'SKU' | 'NAME_CONTAINS';
export type ClassificationMappingSource =
  | 'merchant_override'
  | 'rule_based'
  | 'default';

@Entity('classification_mappings')
@Index(['merchantId', 'active'])
export class ClassificationMappingOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  @Index()
  merchantId!: string;

  @Column('varchar')
  matchType!: ClassificationMatchType;

  @Column('varchar')
  matchValue!: string;

  @Column('varchar', { nullable: true })
  itemType!: string | null;

  /**
   * Nullable to support Mapping Center's NEEDS_REVIEW placeholder rows
   * (an item flagged for classification with no guessed itemClsCd yet — see
   * MappingSuggestionService, which deliberately does not attempt automatic
   * KRA classification-tree matching). ClassificationResolverTypeOrm never
   * sees a null value here in practice: rows with itemClsCd null are always
   * created with active: false, so they're excluded from resolution until a
   * human fills in a code and approves.
   */
  @Column('varchar', { nullable: true })
  itemClsCd!: string | null;

  @Column('int', { default: 100 })
  priority!: number;

  @Column('varchar')
  source!: ClassificationMappingSource;

  @Column('boolean', { default: true })
  active!: boolean;

  // --- Mapping Center dashboard fields (additive; see tax-mapping.orm-entity.ts for rationale) ---

  @Column('varchar', { nullable: true })
  sourceSystem!: SourceSystem | null;

  @Column('varchar', { default: MappingStatus.MAPPED })
  status!: MappingStatus;

  @Column('int', { nullable: true })
  confidenceScore!: number | null;

  @Column('varchar', { nullable: true })
  approvedBy!: string | null;

  @Column('datetime', { nullable: true })
  approvedAt!: Date | null;

  @Column('varchar', { nullable: true })
  externalValue!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
