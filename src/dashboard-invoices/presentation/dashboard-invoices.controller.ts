import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { DashboardInvoicesApplicationService } from '../application/dashboard-invoices.application.service';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import { ActiveTenantGuard } from '../../dashboard-identity/infrastructure/guards/active-tenant.guard';
import { ActiveTenant } from '../../dashboard-identity/infrastructure/decorators/active-tenant.decorator';
import { CreateSaleFromInvoiceDto } from './dto/create-sale-from-invoice.dto';

@Controller('dashboard-api/invoices')
@ApiTags('Dashboard invoices (Mode B)')
@UseGuards(DashboardJwtAuthGuard, ActiveTenantGuard)
@ApiBearerAuth()
export class DashboardInvoicesController {
  constructor(private readonly invoices: DashboardInvoicesApplicationService) {}

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Refresh invoices from the main API and return the current list, previewed only (nothing is submitted to eTIMS). Defaults to whichever ERP is actually connected -- pass ?source= explicitly (quickbooks | odoo | microsoft-dynamics-365-business-central) when more than one is connected.",
  })
  @ApiResponse({ status: 200, description: 'Pull result' })
  async pull(
    @ActiveTenant() tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('source') source?: string,
  ) {
    const result = await this.invoices.pullInvoices(tenantId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      source,
    });
    return { success: true, message: 'Invoices pulled', data: result };
  }

  @Get()
  @ApiOperation({
    summary: 'List pulled invoices for this tenant (preview only)',
  })
  @ApiResponse({ status: 200, description: 'Invoice list' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @ActiveTenant() tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.invoices.listInvoices(tenantId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return { success: true, message: 'OK', data: result };
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Get one pulled invoice with each line resolved against the classified catalog (readyForSale flag)',
  })
  @ApiResponse({ status: 200, description: 'Invoice detail' })
  async getById(@ActiveTenant() tenantId: string, @Param('id') id: string) {
    const invoice = await this.invoices.getInvoiceById(tenantId, id);
    return { success: true, message: 'OK', data: invoice };
  }

  @Post(':id/create-sale')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a Sale from a pulled invoice (every line must already be classified) and submit it to eTIMS',
  })
  @ApiResponse({
    status: 201,
    description: 'Sale created (and submitted unless submit=false)',
  })
  @ApiResponse({
    status: 400,
    description: 'Invoice has unclassified items, or validation failed',
  })
  async createSale(
    @ActiveTenant() tenantId: string,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: CreateSaleFromInvoiceDto,
  ) {
    const data = await this.invoices.createSaleFromInvoice(
      tenantId,
      id,
      { submit: body.submit },
      req,
    );
    return { success: true, message: 'Sale created', data };
  }

  @Get(':id/receipt-attachment-status')
  @ApiOperation({
    summary:
      "Check the Main API sync-item status for the sale created from this invoice (proxies Main API's generic sync-item status lookup)",
  })
  @ApiResponse({ status: 200, description: 'Receipt-attachment status' })
  async getReceiptAttachmentStatus(
    @ActiveTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const data = await this.invoices.getReceiptAttachmentStatus(tenantId, id);
    return { success: true, message: 'OK', data };
  }

  @Post(':id/retry-receipt-attachment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Retry the Main API sync item for the sale created from this invoice (proxies Main API's generic sync-item retry route)",
  })
  @ApiResponse({ status: 200, description: 'Retry result' })
  @ApiResponse({
    status: 400,
    description: 'No Main API sync item recorded for this invoice yet',
  })
  async retryReceiptAttachment(
    @ActiveTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const data = await this.invoices.retryReceiptAttachment(tenantId, id);
    return { success: true, message: 'Retry triggered', data };
  }
}
