import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DashboardMappingApplicationService } from '../application/dashboard-mapping.application.service';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import type { DashboardRequestUser } from '../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';
import { CreateMappingDto } from './dto/create-mapping.dto';
import { UpdateMappingDto } from './dto/update-mapping.dto';

@Controller('dashboard-api/mappings')
@ApiTags('Dashboard mapping center (Mode B)')
@UseGuards(DashboardJwtAuthGuard)
@ApiBearerAuth()
export class DashboardMappingsController {
  constructor(private readonly mappings: DashboardMappingApplicationService) {}

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pull tax rates from the main API (QuickBooks) and run confidence-scored auto-suggestion, ' +
      'creating/refreshing NEEDS_REVIEW tax_mappings rows',
  })
  @ApiResponse({ status: 200, description: 'Pull + suggestion result' })
  async pull(@Req() req: Request) {
    const user = req.user as DashboardRequestUser;
    const result = await this.mappings.pullTaxRates(user.tenantId);
    return { success: true, message: 'Tax rates pulled and scored', data: result };
  }

  @Get()
  @ApiOperation({
    summary: 'List tax/unit/classification mappings for this tenant (plus read-only global defaults)',
  })
  @ApiQuery({ name: 'source', required: false, description: 'quickbooks | xero | manual | api' })
  @ApiQuery({ name: 'type', required: false, description: 'tax | unit | classification' })
  @ApiQuery({ name: 'status', required: false, description: 'mapped | needs_review | unmapped | revised' })
  @ApiResponse({ status: 200, description: 'Mapping list' })
  async list(
    @Req() req: Request,
    @Query('source') source?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    const user = req.user as DashboardRequestUser;
    const result = await this.mappings.list(user.tenantId, { source, type, status });
    return { success: true, message: 'OK', data: result };
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Aggregate mapped/total counts — global defaults and per-source-system, for the progress bars',
  })
  @ApiResponse({ status: 200, description: 'Summary counts' })
  async summary(@Req() req: Request) {
    const user = req.user as DashboardRequestUser;
    const result = await this.mappings.summary(user.tenantId);
    return { success: true, message: 'OK', data: result };
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a suggested mapping as-is (status -> MAPPED, activates it)' })
  @ApiResponse({ status: 200, description: 'Approved mapping' })
  async approve(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as DashboardRequestUser;
    const result = await this.mappings.approve(user.tenantId, id, user.email);
    return { success: true, message: 'Mapping approved', data: result };
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Edit a mapping\'s target code (status -> REVISED if it was already MAPPED/REVISED, otherwise -> MAPPED)',
  })
  @ApiResponse({ status: 200, description: 'Updated mapping' })
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: UpdateMappingDto) {
    const user = req.user as DashboardRequestUser;
    const result = await this.mappings.update(user.tenantId, id, body, user.email);
    return { success: true, message: 'Mapping updated', data: result };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a manual mapping (source MANUAL) — created already MAPPED and active' })
  @ApiResponse({ status: 201, description: 'Created mapping' })
  async create(@Req() req: Request, @Body() body: CreateMappingDto) {
    const user = req.user as DashboardRequestUser;
    const result = await this.mappings.createManual(user.tenantId, body, user.email);
    return { success: true, message: 'Mapping created', data: result };
  }
}
