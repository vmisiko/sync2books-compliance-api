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
}
