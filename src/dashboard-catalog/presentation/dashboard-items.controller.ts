import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { DashboardItemsApplicationService } from '../application/dashboard-items.application.service';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import type { DashboardRequestUser } from '../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';
import { OverrideItemClassificationDto } from './dto/override-item-classification.dto';
import { OverrideStockItemDto } from './dto/override-stock-item.dto';
import { SyncItemsDto } from './dto/sync-items.dto';

@Controller('dashboard-api/items')
@ApiTags('Dashboard items (Mode B)')
@UseGuards(DashboardJwtAuthGuard)
@ApiBearerAuth()
export class DashboardItemsController {
  constructor(private readonly items: DashboardItemsApplicationService) {}

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pull items from the main API (sourced from QuickBooks etc.) and register/auto-classify them in the catalog',
  })
  @ApiResponse({ status: 200, description: 'Pull result' })
  async pull(@Req() req: Request) {
    const user = req.user as DashboardRequestUser;
    const result = await this.items.pullItems(user.tenantId);
    return { success: true, message: 'Items pulled', data: result };
  }

  @Get()
  @ApiOperation({ summary: 'List registered catalog items for this tenant' })
  @ApiResponse({ status: 200, description: 'Item list' })
  async list(@Req() req: Request) {
    const user = req.user as DashboardRequestUser;
    const result = await this.items.listItems(user.tenantId);
    return { success: true, message: 'OK', data: result };
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sync selected (or all PENDING/FAILED) catalog items to KRA eTIMS via OSCU saveItem',
  })
  @ApiResponse({ status: 200, description: 'Sync result' })
  async sync(@Req() req: Request, @Body() body: SyncItemsDto) {
    const user = req.user as DashboardRequestUser;
    const result = await this.items.syncItems(user.tenantId, body.itemIds);
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
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OverrideItemClassificationDto,
  ) {
    const user = req.user as DashboardRequestUser;
    const item = await this.items.overrideClassification(
      user.tenantId,
      id,
      body.classificationCode,
    );
    return { success: true, message: 'Classification updated', data: { item } };
  }

  @Patch(':id/stock-item')
  @ApiOperation({
    summary:
      'Manually set whether an item requires KRA stock tracking, overriding the QuickBooks-derived default',
  })
  @ApiResponse({ status: 200, description: 'Item stock-item flag updated' })
  async overrideStockItem(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: OverrideStockItemDto,
  ) {
    const user = req.user as DashboardRequestUser;
    const item = await this.items.overrideStockItem(
      user.tenantId,
      id,
      body.isStockItem,
    );
    return { success: true, message: 'Stock item flag updated', data: { item } };
  }
}
