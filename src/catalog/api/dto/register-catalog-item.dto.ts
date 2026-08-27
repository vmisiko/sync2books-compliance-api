import { ApiProperty } from '@nestjs/swagger';
import { ItemType } from '../../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

export class RegisterCatalogItemDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty({
    description: 'ERP/external item id (e.g. QuickBooks Item.Id)',
  })
  externalId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  sku?: string | null;

  /**
   * @deprecated no longer read by registerItem() -- itemType is fully
   * derived from productTypeCode now, never an independent input (see
   * CatalogItem.productTypeCode's doc comment). Kept optional, not removed,
   * so existing Mode A (main API) callers that still send it don't break;
   * the value is simply ignored.
   */
  @ApiProperty({ enum: ItemType, required: false, deprecated: true })
  itemType?: ItemType;

  @ApiProperty({ enum: TaxCategory })
  taxCategory!: TaxCategory;

  @ApiProperty({
    required: false,
    description: 'OSCU item classification code (itemClsCd) override',
  })
  classificationCode?: string;

  @ApiProperty({
    required: false,
    description: 'OSCU unit of quantity code (qtyUnitCd) override',
  })
  unitCode?: string;

  @ApiProperty({
    required: false,
    description: 'Internal/ERP unit identifier (EA, PCS, EACH...)',
  })
  internalUnit?: string;

  @ApiProperty({
    required: false,
    description: 'OSCU packaging unit code (pkgUnitCd) override',
  })
  packagingUnitCode?: string;

  @ApiProperty({
    required: false,
    description: 'OSCU tax type code (taxTyCd) override',
  })
  taxTyCd?: string;

  @ApiProperty({
    required: false,
    description: 'OSCU product type code (itemTyCd) override',
  })
  productTypeCode?: string;
}
