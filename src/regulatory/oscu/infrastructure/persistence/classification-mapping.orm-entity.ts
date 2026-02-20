import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @Column('varchar')
  itemClsCd!: string;

  @Column('int', { default: 100 })
  priority!: number;

  @Column('varchar')
  source!: ClassificationMappingSource;

  @Column('boolean', { default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
