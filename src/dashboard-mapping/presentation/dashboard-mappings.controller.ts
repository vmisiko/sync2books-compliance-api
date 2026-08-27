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
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { DashboardMappingApplicationService } from '../application/dashboard-mapping.application.service';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import { ActiveTenantGuard } from '../../dashboard-identity/infrastructure/guards/active-tenant.guard';
import { ActiveTenant } from '../../dashboard-identity/infrastructure/decorators/active-tenant.decorator';
import type { DashboardRequestUser } from '../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';
import { CreateMappingDto } from './dto/create-mapping.dto';
import { UpdateMappingDto } from './dto/update-mapping.dto';

@Controller('dashboard-api/mappings')
@ApiTags('Dashboard mapping center (Mode B)')
@UseGuards(DashboardJwtAuthGuard, ActiveTenantGuard)
@ApiBearerAuth()
export class DashboardMappingsController {
  constructor(private readonly mappings: DashboardMappingApplicationService) {}

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pull tax rates, tax codes, items, and payment methods from the main API ' +
      'for the given ERP source and run confidence-scored auto-suggestion in one pass: ' +
      'creates/refreshes NEEDS_REVIEW tax_mappings and payment_type_mappings rows, resolves a ' +
      'taxCodeId where possible, and tallies how many pulled items are already "ready" (tax ' +
      'AND quantity unit both resolve) vs. not — classification code, packaging unit, and ' +
      'product type are always per-item, hand-filled directly in Item Sync. Item-readiness and ' +
      'payment-method pulls are currently QuickBooks/Odoo-only (no equivalent main-API endpoint ' +
      'exists yet for other sources) and come back with a `skipped` note rather than failing ' +
      'the whole pull.',
  })
  @ApiQuery({
    name: 'source',
    required: false,
    description:
      'quickbooks | xero | sage | odoo | microsoft-dynamics-365-business-central (default quickbooks)',
  })
  @ApiResponse({ status: 200, description: 'Pull + suggestion result' })
  async pull(
    @ActiveTenant() tenantId: string,
    @Query('source') source?: string,
  ) {
    const result = await this.mappings.pullAll(tenantId, source);
    return {
      success: true,
      message:
        'Tax rates, tax codes, classifications, and payment methods pulled and scored',
      data: result,
    };
  }

  @Get()
  @ApiOperation({
    summary:
      'List tax/payment/quantity_unit mappings for this tenant (plus read-only global tax and payment defaults)',
  })
  @ApiQuery({
    name: 'source',
    required: false,
    description: 'quickbooks | xero | manual | api',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    description: 'tax | payment | quantity_unit',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'mapped | needs_review | unmapped | revised',
  })
  @ApiResponse({ status: 200, description: 'Mapping list' })
  async list(
    @ActiveTenant() tenantId: string,
    @Query('source') source?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.mappings.list(tenantId, {
      source,
      type,
      status,
    });
    return { success: true, message: 'OK', data: result };
  }

  @Get('tax-categories')
  @ApiOperation({
    summary:
      "KRA tax-type code options (cdCls '04') for the Tax Mapping 'KRA Code' dropdown — read from oscu_codes, which is kept current via POST catalog/codes/sync (OSCU /selectCodeList), instead of a list hardcoded on the frontend",
  })
  @ApiResponse({ status: 200, description: 'Tax category code options' })
  async taxCategories() {
    const result = await this.mappings.listTaxCategoryOptions();
    return { success: true, message: 'OK', data: result };
  }

  @Get('item-classifications')
  @ApiOperation({
    summary:
      "Search KRA item classification codes (itemClsCd) for Item Sync's Edit Item classification typeahead — proxies CatalogService, since dashboard users have no other authenticated route to that reference data",
  })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'itemClsLvl', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Matching classification codes' })
  async itemClassifications(
    @Query('query') query?: string,
    @Query('itemClsLvl') itemClsLvl?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.mappings.searchItemClassifications({
      query,
      itemClsLvl: itemClsLvl !== undefined ? Number(itemClsLvl) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    return { success: true, message: 'OK', data: result };
  }

  @Get('codes')
  @ApiOperation({
    summary:
      "Search KRA reference codes within a code group (cdCls) — e.g. '10' Unit of Quantity, " +
      "'17' Packaging Unit — for Item Sync's Edit Item quantity/packaging unit " +
      'typeaheads. Proxies CatalogService the same way item-classifications does.',
  })
  @ApiQuery({ name: 'cdCls', required: false })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 200, description: 'Matching KRA codes' })
  async codes(
    @Query('cdCls') cdCls?: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.mappings.searchCodes({
      cdCls,
      query,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    return { success: true, message: 'OK', data: result };
  }

  @Get('payment-methods')
  @ApiOperation({
    summary:
      "Internal payment-method options (the 8 keys oscu-mapping.seed.ts seeds globally) for the Payment Mapping tab's 'Internal Method' dropdown. The KRA-code side of that same modal reuses GET .../codes?cdCls=07, already generic.",
  })
  @ApiResponse({ status: 200, description: 'Payment method options' })
  async paymentMethodOptions() {
    const result = this.mappings.listPaymentMethodOptions();
    return { success: true, message: 'OK', data: result };
  }

  @Get('summary')
  @ApiOperation({
    summary:
      'Aggregate mapped/total counts — global defaults and per-source-system, for the progress bars',
  })
  @ApiResponse({ status: 200, description: 'Summary counts' })
  async summary(@ActiveTenant() tenantId: string) {
    const result = await this.mappings.summary(tenantId);
    return { success: true, message: 'OK', data: result };
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Approve a suggested mapping as-is (status -> MAPPED, activates it)',
  })
  @ApiResponse({ status: 200, description: 'Approved mapping' })
  async approve(
    @ActiveTenant() tenantId: string,
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    const user = req.user as DashboardRequestUser;
    const result = await this.mappings.approve(tenantId, id, user.email);
    return { success: true, message: 'Mapping approved', data: result };
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      "Edit a mapping's target code (status -> REVISED if it was already MAPPED/REVISED, otherwise -> MAPPED)",
  })
  @ApiResponse({ status: 200, description: 'Updated mapping' })
  async update(
    @ActiveTenant() tenantId: string,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateMappingDto,
  ) {
    const user = req.user as DashboardRequestUser;
    const result = await this.mappings.update(tenantId, id, body, user.email);
    return { success: true, message: 'Mapping updated', data: result };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a manual mapping (source MANUAL) — created already MAPPED and active',
  })
  @ApiResponse({ status: 201, description: 'Created mapping' })
  async create(
    @ActiveTenant() tenantId: string,
    @Req() req: Request,
    @Body() body: CreateMappingDto,
  ) {
    const user = req.user as DashboardRequestUser;
    const result = await this.mappings.createManual(tenantId, body, user.email);
    return { success: true, message: 'Mapping created', data: result };
  }
}
