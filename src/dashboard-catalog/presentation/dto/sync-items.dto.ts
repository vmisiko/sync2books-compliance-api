import { ApiProperty } from '@nestjs/swagger';

/** Body for POST dashboard-api/items/sync. */
export class SyncItemsDto {
  @ApiProperty({
    type: [String],
    required: false,
    description:
      'Catalog item ids to sync. Omit (or send an empty array) to sync every PENDING/FAILED item for the tenant.',
  })
  itemIds?: string[];
}
