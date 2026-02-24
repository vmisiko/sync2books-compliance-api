import { ApiProperty } from '@nestjs/swagger';

export class SyncCatalogItemsDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({
    required: false,
    description: 'Optional list of internal item ids to sync.',
    type: [String],
  })
  itemIds?: string[];

  @ApiProperty({
    required: false,
    default: true,
    description:
      'When true, only sync items in PENDING/FAILED state (skips REGISTERED).',
  })
  onlyPending?: boolean;

  @ApiProperty({
    required: false,
    default: false,
    description: 'When true, force re-sync even if already REGISTERED.',
  })
  force?: boolean;
}
