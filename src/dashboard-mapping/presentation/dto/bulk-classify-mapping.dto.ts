import { ApiProperty } from '@nestjs/swagger';

/** Body for PATCH dashboard-api/mappings/bulk-classify. */
export class BulkClassifyMappingDto {
  @ApiProperty({
    type: [String],
    description: 'classification_mappings row ids (clsmap-...)',
  })
  ids!: string[];

  @ApiProperty({ description: 'KRA itemClsCd to apply to every row in ids' })
  itemClsCd!: string;

  @ApiProperty({ required: false, nullable: true })
  itemType?: string | null;
}
