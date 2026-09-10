import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TransferStockDto } from './dto/transfer-stock.dto';
import { ReconcileStockDto } from './dto/reconcile-stock.dto';
import { RepairKraLedgerDto } from './dto/repair-kra-ledger.dto';
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

  @Post('repair-kra-ledger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Bring KRA's Stock IO ledger for one item into agreement with local " +
      'on-hand, then re-declare rsdQty — records NO local movement. Use this ' +
      'when a sale is rejected for "does not exist in your stock master" and ' +
      'the stock push keeps failing on rsdQty: retrying the adjustment can ' +
      'never close that gap, because an adjustment moves both sides equally.',
  })
  @ApiResponse({ status: 200, description: 'Ledger repair outcome' })
  async repairKraLedger(@Body() body: RepairKraLedgerDto) {
    return this.inventoryService.repairKraStockLedger(body);
  }

  @Post('reconcile')
  @ApiOperation({
    summary:
      'Reconcile local stock against an external on-hand quantity (records a RECONCILE ' +
      'movement, then pushes eTIMS insertStockIO followed by saveStockMaster — the same ' +
      'pair a manual adjust sends)',
  })
  @ApiResponse({ status: 201, description: 'Stock reconciled' })
  async reconcileStock(@Body() body: ReconcileStockDto) {
    const result = await this.inventoryService.reconcileStock(body);

    return result;
  }
}
