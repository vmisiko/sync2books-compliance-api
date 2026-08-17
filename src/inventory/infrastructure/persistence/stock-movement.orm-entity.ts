import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/** Append-only ledger -- never updated, only inserted. See stock-movement.entity.ts. */
@Entity('stock_movements')
@Index(['itemId', 'branchId', 'createdAt'])
export class StockMovementOrmEntity {
  @PrimaryColumn('varchar')
  id!: string;

  @Column('varchar')
  @Index()
  itemId!: string;

  @Column('varchar')
  @Index()
  branchId!: string;

  @Column('varchar')
  movementType!: string;

  @Column('int')
  quantity!: number;

  @Column('int')
  balanceAfter!: number;

  @Column('varchar', { nullable: true })
  referenceType!: string | null;

  @Column('varchar', { nullable: true })
  referenceId!: string | null;

  @Column('varchar', { nullable: true })
  sourceSystem!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
