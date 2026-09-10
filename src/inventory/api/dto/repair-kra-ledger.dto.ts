import { ApiProperty } from '@nestjs/swagger';

export class RepairKraLedgerDto {
  @ApiProperty({ description: 'Catalog item id' })
  itemId!: string;

  @ApiProperty({ description: 'Branch id (either form — it is canonicalized)' })
  branchId!: string;

  @ApiProperty({
    required: false,
    description:
      "KRA's current net quantity for this item, from its Stock IO ledger. " +
      'Omit it and the ledger is fetched and totalled automatically; supply it ' +
      'when that fails, which it legitimately can — the documented ' +
      'StockMoveRes carries no sarTyCd, so a movement may not be signable. ' +
      'This figure is written into a tax filing, so a human who has read the ' +
      'ledger is a better source than a guess.',
  })
  kraLedgerQty?: number;
}
