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

  /**
   * Canonical branch id -- `ComplianceBranch.id` (the UUID), never
   * `ComplianceBranch.sync2booksBranchId` (`'00'` and friends). Both forms
   * reach this service (Mode A forwards the main API's branch key, Mode B
   * resolves `branch.id`), and `findByMerchantAndBranch` resolves a
   * connection from either, so nothing downstream rejects the wrong one --
   * the two forms just silently split one logical item+branch pair across two
   * rows with different quantities, and KRA gets told whichever one the
   * caller happened to key. Normalization happens once, in
   * InventoryService.toCanonicalBranchId; the unique constraint below can
   * only stop exact duplicates, not two spellings of the same branch.
   */
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
