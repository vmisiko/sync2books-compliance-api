import { ApiProperty } from '@nestjs/swagger';

export class DashboardRepairKraLedgerDto {
  @ApiProperty({ description: 'Catalog item id' })
  itemId!: string;

  @ApiProperty({ description: 'Branch id' })
  branchId!: string;

  @ApiProperty({
    required: false,
    description:
      "KRA's current net quantity for this item, from its Stock IO ledger. " +
      'Omit it and the ledger is fetched and totalled automatically; supply it ' +
      'only when the response says the movements could not be signed.',
  })
  kraLedgerQty?: number;
}
