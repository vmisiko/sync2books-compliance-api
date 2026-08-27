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

/**
 * Quantity unit ONLY — mirrors tax-mapping.orm-entity.ts's category-based
 * shape (fix once per merchant+category, applies to every item sharing that
 * category). Packaging unit deliberately has no equivalent table: commit
 * 7d0e242 ("Split qtyUnitCd/pkgUnitCd into independent per-item KRA
 * mappings, drop unit_mappings") removed a PRIOR unit_mappings table
 * specifically because it bundled qty+packaging into one row, which was
 * wrong — a packaging choice has no real relationship to a quantity unit
 * (an item measured in KG could be bagged, boxed, or drummed), and picking
 * a qty match silently defaulted packaging as a side effect. This table
 * does not repeat that: it resolves qtyUnitCd only, never touches
 * pkgUnitCd, which is hand-filled per-item directly in Item Sync (see
 * classification-resolver.port.ts's doc comment).
 *
 * Re-introducing a shared table for qty unit specifically (rather than
 * per-item, like packaging/classification) is justified because KRA's real
 * unit-of-quantity code list (cdCls '10') is a small, closed vocabulary —
 * about 30 codes per the OSCU spec (DZ, GLL, GRM, KG, LTR, NO, U, YRD,
 * etc.) — the same shape as tax (5 codes) and payment (8 codes), just
 * bigger. Classification (thousands of rows) and packaging (no ERP source
 * field at all) are the fields that stay per-item.
 */
@Entity('unit_mappings')
@Index(['merchantId', 'internalUnit', 'active'], { unique: true })
export class UnitMappingOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar', { nullable: true })
  merchantId!: string | null;

  /** Null for a pulled external unit label with no confident auto-suggestion (status UNMAPPED) — a human fills this in via PATCH dashboard-api/mappings/:id. Canonical bucket key for a KRA cdCls '10' code, e.g. 'KILOGRAM', 'PIECES' — see QTY_UNIT_ALIASES in mapping-suggestion.service.ts. Falls back to the normalized raw label itself when no alias recognizes it, so every distinct unrecognized label still gets its own reviewable row rather than colliding. */
  @Column('varchar', { nullable: true })
  internalUnit!: string | null;

  /** KRA quantity unit code (qtyUnitCd, cdCls '10'). Null alongside internalUnit for the same UNMAPPED reason. */
  @Column('varchar', { nullable: true })
  qtyUnitCd!: string | null;

  @Column('int', { default: 1 })
  version!: number;

  @Column('boolean', { default: true })
  active!: boolean;

  // --- Mapping Center dashboard fields (additive; see tax-mapping.orm-entity.ts for rationale) ---

  /** Which ERP this row's suggestion/value came from; null for manually-created rows. */
  @Column('varchar', { nullable: true })
  sourceSystem!: SourceSystem | null;

  /** Review-workflow status. */
  @Column('varchar', { default: MappingStatus.NEEDS_REVIEW })
  status!: MappingStatus;

  /** 0-100 auto-suggestion confidence; null for manually-entered rows. */
  @Column('int', { nullable: true })
  confidenceScore!: number | null;

  /** Dashboard user (email) who approved/edited this mapping. */
  @Column('varchar', { nullable: true })
  approvedBy!: string | null;

  @Column('datetime', { nullable: true })
  approvedAt!: Date | null;

  /** Raw unit-of-measure label as it appeared in the source system, e.g. "Kilograms", "each". */
  @Column('varchar', { nullable: true })
  externalValue!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
