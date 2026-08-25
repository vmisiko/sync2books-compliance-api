import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DashboardItemsApplicationService } from '../application/dashboard-items.application.service';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import { ActiveTenantGuard } from '../../dashboard-identity/infrastructure/guards/active-tenant.guard';
import { ActiveTenant } from '../../dashboard-identity/infrastructure/decorators/active-tenant.decorator';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { SyncItemsDto } from './dto/sync-items.dto';

@Controller('dashboard-api/items')
@ApiTags('Dashboard items (Mode B)')
@UseGuards(DashboardJwtAuthGuard, ActiveTenantGuard)
@ApiBearerAuth()
export class DashboardItemsController {
  constructor(private readonly items: DashboardItemsApplicationService) {}

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Pull items from the main API (sourced from whichever ERP is connected) and register/auto-classify them in the catalog. Defaults to whichever ERP is actually connected -- pass ?source= explicitly (quickbooks | odoo | microsoft-dynamics-365-business-central) when more than one is connected.",
  })
  @ApiResponse({ status: 200, description: 'Pull result' })
  async pull(
    @ActiveTenant() tenantId: string,
    @Query('source') source?: string,
  ) {
    const result = await this.items.pullItems(tenantId, source);
    return { success: true, message: 'Items pulled', data: result };
  }

  @Get()
  @ApiOperation({ summary: 'List registered catalog items for this tenant' })
  @ApiResponse({ status: 200, description: 'Item list' })
  async list(@ActiveTenant() tenantId: string) {
    const result = await this.items.listItems(tenantId);
    return { success: true, message: 'OK', data: result };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a manual catalog item (no ERP source) — created as PENDING, same as a pulled item',
  })
  @ApiResponse({ status: 201, description: 'Created item' })
  async create(@ActiveTenant() tenantId: string, @Body() body: CreateItemDto) {
    const item = await this.items.createItem(tenantId, body);
    return { success: true, message: 'Item created', data: { item } };
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sync selected (or all PENDING/FAILED) catalog items to KRA eTIMS via OSCU saveItem',
  })
  @ApiResponse({ status: 200, description: 'Sync result' })
  async sync(@ActiveTenant() tenantId: string, @Body() body: SyncItemsDto) {
    const result = await this.items.syncItems(tenantId, body.itemIds);
    return { success: true, message: 'Items synced', data: result };
  }

  @Patch(':id/classification')
  @ApiOperation({
    summary:
      'Update a catalog item\'s fields -- classification/unit codes for any item (e.g. correcting a code KRA rejected as invalid), or the full field set for a manually-created item that is not yet REGISTERED',
  })
  @ApiResponse({
    status: 200,
    description: 'Item updated',
  })
  async update(
    @ActiveTenant() tenantId: string,
    @Param('id') id: string,
    @Body() body: UpdateItemDto,
  ) {
    const item = await this.items.updateItem(tenantId, id, {
      name: body.name,
      sku: body.sku,
      classificationCode: body.classificationCode,
      unitCode: body.unitCode,
      packagingUnitCode: body.packagingUnitCode,
      unitPrice: body.unitPrice,
      originCountry: body.originCountry,
      taxTyCd: body.taxTyCd,
      productTypeCode: body.productTypeCode,
    });
    return { success: true, message: 'Item updated', data: { item } };
  }
}
