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
  /** Diff against an external system's quantity (e.g. QuickBooks QtyOnHand). */
  RECONCILE = 'RECONCILE',
}
