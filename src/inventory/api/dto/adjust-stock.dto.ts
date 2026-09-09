import { ApiProperty } from '@nestjs/swagger';

export type StockAdjustAction = 'ADD' | 'DEDUCT';

export class AdjustStockDto {
  @ApiProperty()
  itemId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ description: 'Absolute quantity to add/deduct' })
  quantity!: number;

  @ApiProperty({ enum: ['ADD', 'DEDUCT'] })
  action!: StockAdjustAction;

  @ApiProperty({
    required: false,
    description:
      'Optional movement type code for audit (e.g. OSCU stock movement type code)',
  })
  movementTypeCode?: string;

  @ApiProperty({ required: false })
  referenceId?: string;

  @ApiProperty({
    required: false,
    description:
      'Unit price for this quantity -- KRA rejects a zero amount on insertStockIO. ' +
      "Optional: omit it and the item's own catalog price is used. With no price " +
      'anywhere the ledger entry is skipped, which also makes the saveStockMaster ' +
      'that follows fail ("rsdQty mismatch") -- the response\'s `etims` block says ' +
      'which half went through.',
  })
  unitPrice?: number;
}
