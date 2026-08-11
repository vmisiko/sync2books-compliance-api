import { ApiProperty } from '@nestjs/swagger';

export class TransferStockDto {
  @ApiProperty({ description: 'Source item id' })
  itemId!: string;

  @ApiProperty({ description: 'Source branch id' })
  fromBranchId!: string;

  @ApiProperty({ description: 'Destination item id (may differ by business)' })
  receivingItemId!: string;

  @ApiProperty({ description: 'Destination branch id' })
  toBranchId!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty({ required: false, description: 'Optional correlation id' })
  referenceId?: string;

  @ApiProperty({
    required: false,
    description: 'Unit price, required for the eTIMS insertStockIO sync to succeed.',
  })
  unitPrice?: number;
}
