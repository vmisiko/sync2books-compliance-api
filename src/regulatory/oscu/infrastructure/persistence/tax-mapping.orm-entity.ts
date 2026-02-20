import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
