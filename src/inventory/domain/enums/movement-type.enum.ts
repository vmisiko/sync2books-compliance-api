/**
 * Stock movement types.
 * See 05-inventory-and-multi-branch-spec.md
 */
export enum MovementType {
  SALE = 'SALE',
  PURCHASE = 'PURCHASE',
  TRANSFER_OUT = 'TRANSFER_OUT',
  TRANSFER_IN = 'TRANSFER_IN',
  ADJUSTMENT = 'ADJUSTMENT',
  RETURN = 'RETURN',
}
