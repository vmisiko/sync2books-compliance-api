import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ItemType } from '../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post('items')
  async registerItem(
    @Body()
    body: {
      merchantId: string;
      externalId: string;
      name: string;
      sku?: string | null;
      itemType: ItemType;
      taxCategory: TaxCategory;
      classificationCode?: string;
      unitCode?: string;
      internalUnit?: string;
      packagingUnitCode?: string;
      taxTyCd?: string;
      productTypeCode?: string;
    },
  ) {
    return this.catalogService.registerItem(body);
  }

  @Get('merchants/:merchantId/items')
  async listItems(@Param('merchantId') merchantId: string) {
    return this.catalogService.listItems(merchantId);
  }
}
