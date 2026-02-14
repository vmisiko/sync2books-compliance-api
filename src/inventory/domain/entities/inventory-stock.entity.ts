/**
 * Stock level per branch.
 * Stock is scoped per branch (bhfId) - never compute globally.
 */
export interface InventoryStock {
  itemId: string;
  branchId: string;
  quantityOnHand: number;
  reservedQuantity: number;
  lastMovementAt: Date;
  updatedAt: Date;
}
