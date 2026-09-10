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
      "Unit price. Optional -- omit it and the item's own catalog price is used, which " +
      "is what lets the dashboard's inline stock edit (which has nowhere to type one) " +
      'reach KRA. With no price anywhere the insertStockIO ledger entry is skipped, and ' +
      'because KRA derives the expected rsdQty from that ledger, the saveStockMaster that ' +
      "follows is then rejected too. The response's `etims` block reports both halves.",
  })
  unitPrice?: number;
}
