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
      'Unit price for this quantity, required for the eTIMS insertStockIO sync ' +
      '(ETIMS_STOCK_SYNC) to actually succeed -- KRA rejects a zero amount. Without ' +
      'it, the adjustment still records locally but the eTIMS sync is skipped.',
  })
  unitPrice?: number;
}
