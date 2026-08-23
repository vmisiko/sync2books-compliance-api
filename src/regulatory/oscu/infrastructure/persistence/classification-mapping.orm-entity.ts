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

  /**
   * This item's internalTaxCategory as derived at pull time from the source
   * ERP's own standardized tax category (resolved by main-api, see
   * standardized-item.mapper.ts) — captured here (not just computed live) so
   * the Mapping Center can show,
   * per item, whether its tax dimension will actually resolve at
   * registration without needing a fresh ERP call. Cross-referenced against
   * tax_mappings at list time (see DashboardMappingApplicationService.list)
   * to populate the row's resolvedTaxTyCd. Tax stays category-based (KRA
   * only has 5 tax types, so sharing one approved row per category is
   * correct) — unlike quantity/packaging units below, which are resolved
   * per item because KRA's real unit code lists are large and
   * business-specific, and packaging in particular has no natural shared
   * bucket.
   */
  @Column('varchar', { nullable: true })
  resolvedInternalTaxCategory!: string | null;

  /**
   * Quantity unit (qtyUnitCd) and packaging unit (pkgUnitCd) are resolved
   * independently per item, each matched directly against the real synced
   * KRA code list (oscu_codes, cdCls '10' and '17' respectively) — not
   * against an internal category table. Matched from the ERP's raw unit
   * label (MainApiItem.unitOfMeasure) at pull time: an exact match against
   * a KRA code gets a high confidenceScore, a fuzzy name match gets a lower
   * one, and no match leaves both null (NEEDS_REVIEW). They're only ever
   * combined into one payload at the point of the actual OSCU /saveItem
   * call — never coupled together as a single "unit" concept before that.
   */
  @Column('varchar', { nullable: true })
  qtyUnitCd!: string | null;

  @Column('int', { nullable: true })
  qtyUnitCdConfidence!: number | null;

  @Column('varchar', { nullable: true })
  pkgUnitCd!: string | null;

  @Column('int', { nullable: true })
  pkgUnitCdConfidence!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
