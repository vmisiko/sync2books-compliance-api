import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import { ActiveTenantGuard } from '../../dashboard-identity/infrastructure/guards/active-tenant.guard';
import { ActiveTenant } from '../../dashboard-identity/infrastructure/decorators/active-tenant.decorator';
import { DashboardSuppliersApplicationService } from '../application/dashboard-suppliers.application.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

/**
 * Guarded the same way as `DashboardCustomersController`: trusts `merchantId`
 * from the request query rather than deriving it from the verified token.
 * `pull` is the one exception — it derives the tenant from ActiveTenantGuard
 * since it has no merchantId query param at all.
 */
@Controller('dashboard-api/suppliers')
@ApiTags('Dashboard Suppliers')
@UseGuards(DashboardJwtAuthGuard)
@ApiBearerAuth()
export class DashboardSuppliersController {
  constructor(
    private readonly suppliers: DashboardSuppliersApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List/search suppliers for a merchant' })
  @ApiResponse({ status: 200, description: 'Supplier list' })
  async list(
    @Query('merchantId') merchantId: string,
    @Query('search') search?: string,
  ) {
    return this.suppliers.list(merchantId, search);
  }

  @Post()
  @ApiOperation({ summary: 'Create a supplier' })
  @ApiResponse({ status: 201, description: 'Supplier created' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  async create(@Body() body: CreateSupplierDto) {
    return this.suppliers.create(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a supplier' })
  @ApiResponse({ status: 200, description: 'Supplier updated' })
  async update(
    @Query('merchantId') merchantId: string,
    @Param('id') id: string,
    @Body() body: UpdateSupplierDto,
  ) {
    return this.suppliers.update(merchantId, id, body);
  }

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pull suppliers (via the main API) and upsert them locally, matched by external supplier id. Defaults to whichever ERP is actually connected -- pass ?source= explicitly (quickbooks | odoo | microsoft-dynamics-365-business-central) when more than one is connected.',
  })
  @ApiResponse({ status: 200, description: 'Pull result' })
  @UseGuards(ActiveTenantGuard)
  async pull(
    @ActiveTenant() tenantId: string,
    @Query('source') source?: string,
  ) {
    return this.suppliers.pullSuppliers(tenantId, source);
  }

  @Get('verify-kra')
  @ApiOperation({
    summary:
      'Check a PIN against the OSCU-synced customer/taxpayer PIN registry (customerPinInfo) for this branch',
  })
  @ApiResponse({ status: 200, description: 'Verification result' })
  async verifyKra(
    @Query('merchantId') merchantId: string,
    @Query('branchId') branchId: string,
    @Query('tin') tin: string,
  ) {
    return this.suppliers.verifyKra(merchantId, branchId, tin);
  }
}
