import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('payment_type_mappings')
@Index(['merchantId', 'internalPaymentMethod', 'active'], { unique: true })
export class PaymentTypeMappingOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar', { nullable: true })
  merchantId!: string | null;

  @Column('varchar')
  internalPaymentMethod!: string;

  /** OSCU pmtTyCd (code classification 07) */
  @Column('varchar')
  pmtTyCd!: string;

  @Column('int', { default: 1 })
  version!: number;

  @Column('boolean', { default: true })
  active!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
