import { Body, Controller, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TransferStockDto } from './dto/transfer-stock.dto';
import { ComplianceServiceAuthGuard } from '../../integration/compliance-service-auth.guard';
import { PlatformOscuCallbackService } from '../../integration/platform-outbound/platform-oscu-callback.service';

@Controller('api/stock')
@ApiTags('Stock')
@UseGuards(ComplianceServiceAuthGuard)
export class StockController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly oscuCallback: PlatformOscuCallbackService,
  ) {}

  @Post('transfer')
  @ApiOperation({ summary: 'Transfer stock between businesses/branches' })
  @ApiResponse({ status: 201, description: 'Stock transferred' })
  async transferStock(@Body() body: TransferStockDto, @Req() req: Request) {
    const result = await this.inventoryService.transferStock(body);
    await this.oscuCallback.emitStockOutcome(req, 'STOCK_TRANSFER', {
      referenceId: result.referenceId,
    });
    return result;
  }

  @Put('adjust')
  @ApiOperation({ summary: 'Adjust item stock' })
  @ApiResponse({ status: 200, description: 'Stock adjusted' })
  async adjustStock(@Body() body: AdjustStockDto, @Req() req: Request) {
    const result = await this.inventoryService.adjustStock(body);
    await this.oscuCallback.emitStockOutcome(req, 'STOCK_ADJUST', {
      itemId: body.itemId,
      branchId: body.branchId,
    });
    return result;
  }
}
