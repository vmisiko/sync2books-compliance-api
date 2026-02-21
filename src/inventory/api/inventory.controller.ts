import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { RecordMovementDto } from './dto/record-movement.dto';

@Controller('inventory')
@ApiTags('Inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('movements')
  @ApiOperation({ summary: 'Create stock movement' })
  @ApiResponse({ status: 201, description: 'Stock movement recorded' })
  async recordMovement(
    @Body()
    body: RecordMovementDto,
  ) {
    return this.inventoryService.recordMovement(body);
  }

  @Get('branches/:branchId/items/:itemId')
  @ApiOperation({ summary: 'Get stock level for item in branch' })
  @ApiResponse({ status: 200, description: 'Stock level' })
  async getStockLevel(
    @Param('branchId') branchId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.inventoryService.getStockLevel(itemId, branchId);
  }
}
