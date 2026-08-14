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

@Entity('unit_mappings')
@Index(['merchantId', 'internalUnit', 'active'], { unique: true })
export class UnitMappingOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar', { nullable: true })
  merchantId!: string | null;

  @Column('varchar')
  internalUnit!: string;

  @Column('varchar')
  qtyUnitCd!: string;

  @Column('varchar')
  pkgUnitCd!: string;

  @Column('int', { default: 1 })
  version!: number;

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
