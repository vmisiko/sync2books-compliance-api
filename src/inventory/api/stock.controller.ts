import { Body, Controller, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TransferStockDto } from './dto/transfer-stock.dto';
import { ComplianceServiceAuthGuard } from '../../integration/compliance-service-auth.guard';

@Controller('api/stock')
@ApiTags('Stock')
@UseGuards(ComplianceServiceAuthGuard)
export class StockController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('transfer')
  @ApiOperation({ summary: 'Transfer stock between businesses/branches' })
  @ApiResponse({ status: 201, description: 'Stock transferred' })
  async transferStock(@Body() body: TransferStockDto) {
    return this.inventoryService.transferStock(body);
  }

  @Put('adjust')
  @ApiOperation({ summary: 'Adjust item stock' })
  @ApiResponse({ status: 200, description: 'Stock adjusted' })
  async adjustStock(@Body() body: AdjustStockDto) {
    return this.inventoryService.adjustStock(body);
  }
}
