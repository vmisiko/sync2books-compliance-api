import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
