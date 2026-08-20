import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import { ActiveTenantGuard } from '../../dashboard-identity/infrastructure/guards/active-tenant.guard';
import { ActiveTenant } from '../../dashboard-identity/infrastructure/decorators/active-tenant.decorator';
import { DashboardPurchasesApplicationService } from '../application/dashboard-purchases.application.service';
import { PullPurchasesDto, PurchaseIdsDto } from './dto/purchase.dto';

@Controller('dashboard-api/purchases')
@ApiTags('Dashboard purchases (Mode B)')
@UseGuards(DashboardJwtAuthGuard, ActiveTenantGuard)
@ApiBearerAuth()
export class DashboardPurchasesController {
  constructor(private readonly purchases: DashboardPurchasesApplicationService) {}

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Pull supplier invoices from KRA OSCU (getPurchaseTransactionInfo) and upsert them locally, preserving each invoice's existing review status",
  })
  @ApiResponse({ status: 200, description: 'Pull result' })
  async pull(@ActiveTenant() tenantId: string, @Body() body: PullPurchasesDto) {
    const data = await this.purchases.pull(tenantId, {
      branchId: body.branchId,
      autoMarkPendingReview: body.autoMarkPendingReview,
    });
    return { success: true, message: 'Purchase invoices pulled', data };
  }

  @Get()
  @ApiOperation({ summary: 'List purchase invoices for this tenant' })
  @ApiResponse({ status: 200, description: 'Purchase invoice list' })
  async list(@ActiveTenant() tenantId: string) {
    const data = await this.purchases.list(tenantId);
    return { success: true, message: 'OK', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one purchase invoice' })
  @ApiResponse({ status: 200, description: 'Purchase invoice detail' })
  async getById(@ActiveTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.purchases.getById(tenantId, id);
    return { success: true, message: 'OK', data };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Mark purchase invoices confirmed for Input VAT eligibility (invoices without a supplier PIN are skipped)',
  })
  @ApiResponse({ status: 200, description: 'Updated purchase invoice list' })
  async confirm(@ActiveTenant() tenantId: string, @Body() body: PurchaseIdsDto) {
    const data = await this.purchases.confirm(tenantId, body.ids);
    return { success: true, message: 'Invoices confirmed', data };
  }

  @Post('reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark purchase invoices rejected' })
  @ApiResponse({ status: 200, description: 'Updated purchase invoice list' })
  async reject(@ActiveTenant() tenantId: string, @Body() body: PurchaseIdsDto) {
    const data = await this.purchases.reject(tenantId, body.ids);
    return { success: true, message: 'Invoices rejected', data };
  }

  @Post('sync-to-erp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sync confirmed purchase invoices to a connected ERP (not implemented yet)',
  })
  @ApiResponse({ status: 400, description: 'Not implemented yet' })
  async syncToErp(@ActiveTenant() tenantId: string, @Body() body: PurchaseIdsDto) {
    this.purchases.syncToErp(tenantId, body.ids);
  }
}
