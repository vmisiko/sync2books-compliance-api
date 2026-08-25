import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for PATCH dashboard-api/items/:id/classification — every field is
 * optional, mirroring CreateItemDto's fields so the dashboard's "Edit Item"
 * form can reuse the same shape it uses to create one. At least one field
 * must be supplied (enforced in DashboardItemsApplicationService.updateItem).
 * See that method's doc comment for how this differs for ERP-sourced vs
 * manually-created items.
 */
export class UpdateItemDto {
  @ApiPropertyOptional({ description: 'Item name' })
  name?: string;

  @ApiPropertyOptional({ description: 'Unique product code / barcode (bcd)' })
  sku?: string | null;

  @ApiPropertyOptional({
    enum: ['1', '2', '3'],
    description:
      "OSCU product type code (itemTyCd, cdCls '24'): '1' Raw Material, '2' Finished Product, '3' Service",
  })
  productTypeCode?: string;

  @ApiPropertyOptional({
    description: 'OSCU item classification code (itemClsCd) to force for this item',
    example: '14111400',
  })
  classificationCode?: string;

  @ApiPropertyOptional({
    description: "OSCU quantity unit code (qtyUnitCd, cdCls '10') to force for this item",
    example: 'NO',
  })
  unitCode?: string;

  @ApiPropertyOptional({
    description: "OSCU packaging unit code (pkgUnitCd, cdCls '17') to force for this item",
    example: 'NT',
  })
  packagingUnitCode?: string;

  @ApiPropertyOptional({ description: "OSCU tax type code (taxTyCd, cdCls '04')", example: 'B' })
  taxTyCd?: string;

  @ApiPropertyOptional({ description: 'OSCU default unit price (dftPrc)' })
  unitPrice?: number | null;

  @ApiPropertyOptional({ description: 'OSCU country of origin (orgnNatCd)' })
  originCountry?: string | null;
}
