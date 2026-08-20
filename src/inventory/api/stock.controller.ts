import { Body, Controller, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TransferStockDto } from './dto/transfer-stock.dto';
import { ReconcileStockDto } from './dto/reconcile-stock.dto';
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
    const result = await this.inventoryService.transferStock(body);
    return result;
  }

  @Put('adjust')
  @ApiOperation({ summary: 'Adjust item stock' })
  @ApiResponse({ status: 200, description: 'Stock adjusted' })
  async adjustStock(@Body() body: AdjustStockDto) {
    const result = await this.inventoryService.adjustStock(body);

    return result;
  }

  @Post('reconcile')
  @ApiOperation({
    summary:
      'Reconcile local stock against an external on-hand quantity (records a RECONCILE ' +
      'movement and pushes eTIMS saveStockMaster, unlike adjust which only pushes insertStockIO)',
  })
  @ApiResponse({ status: 201, description: 'Stock reconciled' })
  async reconcileStock(@Body() body: ReconcileStockDto) {
    const result = await this.inventoryService.reconcileStock(body);

    return result;
  }
}
