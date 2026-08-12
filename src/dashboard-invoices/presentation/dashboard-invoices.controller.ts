import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DashboardInvoicesApplicationService } from '../application/dashboard-invoices.application.service';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import type { DashboardRequestUser } from '../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';
import { CreateSaleFromInvoiceDto } from './dto/create-sale-from-invoice.dto';

@Controller('dashboard-api/invoices')
@ApiTags('Dashboard invoices (Mode B)')
@UseGuards(DashboardJwtAuthGuard)
@ApiBearerAuth()
export class DashboardInvoicesController {
  constructor(private readonly invoices: DashboardInvoicesApplicationService) {}

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Refresh invoices from the main API (sourced from QuickBooks etc.) and return the current list, previewed only (nothing is submitted to eTIMS)',
  })
  @ApiResponse({ status: 200, description: 'Pull result' })
  async pull(@Req() req: Request, @Query('page') page?: string, @Query('limit') limit?: string) {
    const user = req.user as DashboardRequestUser;
    const result = await this.invoices.pullInvoices(user.tenantId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return { success: true, message: 'Invoices pulled', data: result };
  }

  @Get()
  @ApiOperation({ summary: 'List pulled invoices for this tenant (preview only)' })
  @ApiResponse({ status: 200, description: 'Invoice list' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(@Req() req: Request, @Query('page') page?: string, @Query('limit') limit?: string) {
    const user = req.user as DashboardRequestUser;
    const result = await this.invoices.listInvoices(user.tenantId, {
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
  async getById(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as DashboardRequestUser;
    const invoice = await this.invoices.getInvoiceById(user.tenantId, id);
    return { success: true, message: 'OK', data: invoice };
  }

  @Post(':id/create-sale')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a Sale from a pulled invoice (every line must already be classified) and submit it to eTIMS',
  })
  @ApiResponse({ status: 201, description: 'Sale created (and submitted unless submit=false)' })
  @ApiResponse({ status: 400, description: 'Invoice has unclassified items, or validation failed' })
  async createSale(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: CreateSaleFromInvoiceDto,
  ) {
    const user = req.user as DashboardRequestUser;
    const data = await this.invoices.createSaleFromInvoice(user.tenantId, id, {
      submit: body.submit,
    });
    return { success: true, message: 'Sale created', data };
  }
}
