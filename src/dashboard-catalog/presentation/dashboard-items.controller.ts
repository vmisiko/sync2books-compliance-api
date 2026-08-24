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
import { OverrideItemClassificationDto } from './dto/override-item-classification.dto';
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
    summary: 'Manually override the OSCU classification for an item',
  })
  @ApiResponse({
    status: 200,
    description: 'Item re-registered with the new classification',
  })
  async overrideClassification(
    @ActiveTenant() tenantId: string,
    @Param('id') id: string,
    @Body() body: OverrideItemClassificationDto,
  ) {
    const item = await this.items.overrideClassification(
      tenantId,
      id,
      body.classificationCode,
    );
    return { success: true, message: 'Classification updated', data: { item } };
  }
}
