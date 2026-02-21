import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { RegisterCatalogItemDto } from './dto/register-catalog-item.dto';

@Controller('catalog')
@ApiTags('Catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Post('items')
  @ApiOperation({ summary: 'Create or update compliance item' })
  @ApiResponse({ status: 201, description: 'Item created or updated' })
  async registerItem(
    @Body()
    body: RegisterCatalogItemDto,
  ) {
    return this.catalogService.registerItem(body);
  }

  @Get('merchants/:merchantId/items')
  @ApiOperation({ summary: 'List compliance items' })
  @ApiResponse({ status: 200, description: 'Item list' })
  async listItems(@Param('merchantId') merchantId: string) {
    return this.catalogService.listItems(merchantId);
  }
}
