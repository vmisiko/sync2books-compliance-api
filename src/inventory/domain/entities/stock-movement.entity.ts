import type { MovementType } from '../enums/movement-type.enum';

/**
 * Stock movement - the only way to change stock levels.
 * Direct updates forbidden.
 */
export interface StockMovement {
  id: string;
  itemId: string;
  branchId: string;
  movementType: MovementType;
  quantity: number; // Positive for in, negative for out
  referenceType: string | null; // e.g. 'INVOICE', 'PURCHASE_ORDER'
  referenceId: string | null;
  createdAt: Date;
}
