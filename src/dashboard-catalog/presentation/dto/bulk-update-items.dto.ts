import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Body for PATCH dashboard-api/items/bulk-classification. */
export class BulkUpdateItemsDto {
  @ApiProperty({ type: [String], description: 'Catalog item ids' })
  itemIds!: string[];

  @ApiPropertyOptional({
    description: 'OSCU item classification code (itemClsCd) to apply to every item in itemIds',
    example: '14111400',
  })
  classificationCode?: string;

  @ApiPropertyOptional({
    description: "OSCU packaging unit code (pkgUnitCd, cdCls '17') to apply to every item in itemIds",
    example: 'NT',
  })
  packagingUnitCode?: string;

  @ApiPropertyOptional({
    enum: ['1', '2', '3'],
    description:
      "OSCU product type code (itemTyCd, cdCls '24') to apply to every item in itemIds: '1' Raw Material, '2' Finished Product, '3' Service",
  })
  productTypeCode?: string;
}
