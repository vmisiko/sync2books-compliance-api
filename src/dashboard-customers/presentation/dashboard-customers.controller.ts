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
  Req,
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
import { DashboardCustomersApplicationService } from '../application/dashboard-customers.application.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
} from './dto/customer.dto';

/**
 * Guarded the same way as `DashboardSalesController`: trusts `merchantId`
 * from the request body/query rather than deriving it from the verified
 * token. Keep consistent with that controller until the shared auth fix
 * lands for both. `pull` is the one exception — it derives the tenant from
 * ActiveTenantGuard since it has no merchantId query param at all.
 */
@Controller('dashboard-api/customers')
@ApiTags('Dashboard Customers')
@UseGuards(DashboardJwtAuthGuard)
@ApiBearerAuth()
export class DashboardCustomersController {
  constructor(private readonly customers: DashboardCustomersApplicationService) {}

  @Get()
  @ApiOperation({ summary: 'List/search customers for a merchant' })
  @ApiResponse({ status: 200, description: 'Customer list' })
  async list(
    @Query('merchantId') merchantId: string,
    @Query('search') search?: string,
  ) {
    return this.customers.list(merchantId, search);
  }

  @Post()
  @ApiOperation({ summary: 'Create a customer' })
  @ApiResponse({ status: 201, description: 'Customer created' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  async create(@Body() body: CreateCustomerDto) {
    return this.customers.create(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a customer' })
  @ApiResponse({ status: 200, description: 'Customer updated' })
  async update(
    @Query('merchantId') merchantId: string,
    @Param('id') id: string,
    @Body() body: UpdateCustomerDto,
  ) {
    return this.customers.update(merchantId, id, body);
  }

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pull customers from QuickBooks (via the main API) and upsert them locally, matched by external customer id',
  })
  @ApiResponse({ status: 200, description: 'Pull result' })
  @UseGuards(ActiveTenantGuard)
  async pull(@ActiveTenant() tenantId: string) {
    return this.customers.pullCustomers(tenantId);
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
    return this.customers.verifyKra(merchantId, branchId, tin);
  }
}
