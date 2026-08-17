import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('inventory_stock')
@Unique(['itemId', 'branchId'])
export class InventoryStockOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  @Index()
  itemId!: string;

  @Column('varchar')
  @Index()
  branchId!: string;

  @Column('int', { default: 0 })
  quantityOnHand!: number;

  @Column('int', { default: 0 })
  reservedQuantity!: number;

  /** Manual optimistic-lock counter -- bumped on every applyDelta write. */
  @Column('int', { default: 1 })
  version!: number;

  @Column('datetime', { nullable: true })
  lastMovementAt!: Date | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
