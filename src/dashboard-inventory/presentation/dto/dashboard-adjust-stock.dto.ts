import { ApiProperty } from '@nestjs/swagger';

export type StockAdjustAction = 'ADD' | 'DEDUCT';

export class DashboardAdjustStockDto {
  @ApiProperty({ description: 'Catalog item id (manual or QuickBooks-sourced)' })
  itemId!: string;

  @ApiProperty({ description: 'Branch id (sync2books branch id)' })
  branchId!: string;

  @ApiProperty({ description: 'Absolute quantity to add/deduct' })
  quantity!: number;

  @ApiProperty({ enum: ['ADD', 'DEDUCT'] })
  action!: StockAdjustAction;

  @ApiProperty({ required: false, description: 'e.g. free-text reason for the adjustment' })
  referenceId?: string;

  @ApiProperty({
    required: false,
    description:
      'Unit price, required for the eTIMS insertStockIO sync to succeed. Without it, the adjustment still records locally.',
  })
  unitPrice?: number;
}
