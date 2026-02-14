import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { MovementType } from '../domain/enums/movement-type.enum';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('movements')
  async recordMovement(
    @Body()
    body: {
      itemId: string;
      branchId: string;
      movementType: MovementType;
      quantity: number;
      referenceType?: string | null;
      referenceId?: string | null;
    },
  ) {
    return this.inventoryService.recordMovement(body);
  }

  @Get('branches/:branchId/items/:itemId')
  async getStockLevel(
    @Param('branchId') branchId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.inventoryService.getStockLevel(itemId, branchId);
  }
}
