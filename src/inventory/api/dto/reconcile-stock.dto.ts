import { ApiProperty } from '@nestjs/swagger';

export class ReconcileStockDto {
  @ApiProperty()
  itemId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({
    description:
      'Absolute on-hand quantity from the external source of truth (e.g. QuickBooks QtyOnHand)',
  })
  externalQtyOnHand!: number;

  @ApiProperty({ required: false })
  sourceSystem?: string;

  @ApiProperty({ required: false })
  referenceId?: string;

  @ApiProperty({
    required: false,
    description:
      'Unit price for the reconciled quantity, required for the eTIMS saveStockMaster sync ' +
      '(ETIMS_STOCK_MASTER_SYNC) to actually succeed -- KRA rejects a zero amount.',
  })
  unitPrice?: number;
}
