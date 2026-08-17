import { ApiProperty } from '@nestjs/swagger';

export class DashboardTransferStockDto {
  @ApiProperty({ description: 'Catalog item id being transferred' })
  itemId!: string;

  @ApiProperty({ description: 'Source branch id (sync2books branch id)' })
  fromBranchId!: string;

  @ApiProperty({
    description: 'Destination branch id (sync2books branch id)',
  })
  toBranchId!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({
    required: false,
    description:
      'Unit price, required for the eTIMS insertStockIO sync to succeed.',
  })
  unitPrice?: number;
}
