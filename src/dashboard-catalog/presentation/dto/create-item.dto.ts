import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for POST dashboard-api/items — a manually-created catalog item with
 * no ERP source (externalId stays null). This codebase doesn't use
 * class-validator elsewhere, so required-field validation is done in the
 * application layer (DashboardItemsApplicationService.createItem) to match
 * convention (see CreateMappingDto for the same rationale).
 */
export class CreateItemDto {
  @ApiProperty({ description: 'Item name' })
  name!: string;

  @ApiProperty({ required: false, description: 'Unique product code / barcode (bcd)' })
  sku?: string | null;

  @ApiProperty({
    enum: ['1', '2', '3'],
    description:
      "OSCU product type code (itemTyCd, cdCls '24'): '1' Raw Material, '2' Finished Product, '3' Service",
    example: '2',
  })
  productTypeCode!: string;

  @ApiProperty({ description: 'OSCU item classification code (itemClsCd)', example: '14111400' })
  classificationCode!: string;

  @ApiProperty({ description: "OSCU quantity unit code (qtyUnitCd, cdCls '10')", example: 'KG' })
  unitCode!: string;

  @ApiProperty({ description: "OSCU packaging unit code (pkgUnitCd, cdCls '17')", example: 'BG' })
  packagingUnitCode!: string;

  @ApiProperty({ description: "OSCU tax type code (taxTyCd, cdCls '04')", example: 'B' })
  taxTyCd!: string;

  @ApiProperty({ required: false, description: 'OSCU default unit price (dftPrc)' })
  unitPrice?: number | null;

  @ApiProperty({
    required: false,
    default: 'KE',
    description: 'OSCU country of origin (orgnNatCd)',
  })
  originCountry?: string | null;
}
