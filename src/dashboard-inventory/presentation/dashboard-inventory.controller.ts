import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DashboardInventoryApplicationService } from '../application/dashboard-inventory.application.service';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import { ActiveTenantGuard } from '../../dashboard-identity/infrastructure/guards/active-tenant.guard';
import { ActiveTenant } from '../../dashboard-identity/infrastructure/decorators/active-tenant.decorator';
import { DashboardAdjustStockDto } from './dto/dashboard-adjust-stock.dto';
import { DashboardTransferStockDto } from './dto/dashboard-transfer-stock.dto';

@Controller('dashboard-api/inventory')
@ApiTags('Dashboard inventory (Mode B)')
@UseGuards(DashboardJwtAuthGuard, ActiveTenantGuard)
@ApiBearerAuth()
export class DashboardInventoryController {
  constructor(
    private readonly inventory: DashboardInventoryApplicationService,
  ) {}

  @Get('branches')
  @ApiOperation({ summary: 'List branches for this tenant' })
  async listBranches(@ActiveTenant() tenantId: string) {
    const branches = await this.inventory.listBranches(tenantId);
    return { success: true, message: 'OK', data: { branches } };
  }

  @Get('stock')
  @ApiOperation({ summary: 'List current stock levels, optionally filtered by branch' })
  async listStock(@Query('branchId') branchId?: string) {
    const stock = await this.inventory.listStock(branchId);
    return { success: true, message: 'OK', data: { stock } };
  }

  @Get('movements')
  @ApiOperation({ summary: 'List stock movement history, optionally filtered by item/branch' })
  async listMovements(
    @Query('itemId') itemId?: string,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    const movements = await this.inventory.listMovements({
      itemId,
      branchId,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, message: 'OK', data: { movements } };
  }

  @Put('adjust')
  @ApiOperation({
    summary:
      'Manually add or deduct stock -- the only way a manually-created item (no ERP source) ever gets a quantity',
  })
  @ApiResponse({ status: 200, description: 'Stock adjusted' })
  async adjust(@Body() body: DashboardAdjustStockDto) {
    const result = await this.inventory.adjust(body);
    return { success: true, message: 'Stock adjusted', data: result };
  }

  @Post('transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Transfer stock between branches -- internal bookkeeping only, no KRA submission',
  })
  @ApiResponse({ status: 200, description: 'Stock transferred' })
  async transfer(@Body() body: DashboardTransferStockDto) {
    const result = await this.inventory.transfer(body);
    return { success: true, message: 'Stock transferred', data: result };
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pull current QtyOnHand from QuickBooks (via the main API) and reconcile it into the default branch\'s stock',
  })
  @ApiResponse({ status: 200, description: 'Reconciliation result' })
  async reconcile(@ActiveTenant() tenantId: string) {
    const result = await this.inventory.reconcile(tenantId);
    return { success: true, message: 'Stock reconciled', data: result };
  }
}
