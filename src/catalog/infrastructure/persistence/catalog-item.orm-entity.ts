import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('catalog_items')
export class CatalogItemOrmEntity {
  @PrimaryColumn()
  id!: string;

  @Column()
  merchantId!: string;

  @Column()
  externalId!: string;

  @Column()
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  sku!: string | null;

  @Column({ type: 'varchar' })
  itemType!: string;

  @Column({ type: 'varchar' })
  taxCategory!: string;

  @Column()
  classificationCode!: string;

  @Column()
  unitCode!: string;

  @Column({ type: 'varchar', default: 'NT' })
  packagingUnitCode!: string;

  @Column({ type: 'varchar', default: 'B' })
  taxTyCd!: string;

  @Column({ type: 'varchar', default: '2' })
  productTypeCode!: string;

  @Column({ type: 'varchar', default: 'PENDING' })
  registrationStatus!: 'PENDING' | 'REGISTERED' | 'FAILED';

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'datetime', nullable: true })
  lastSyncedAt!: Date | null; // SQLite stores as ISO string

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
