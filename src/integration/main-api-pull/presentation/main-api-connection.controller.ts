import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { MainApiConnectionApplicationService } from '../application/main-api-connection.application.service';
import { DashboardJwtAuthGuard } from '../../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import { ActiveTenantGuard } from '../../../dashboard-identity/infrastructure/guards/active-tenant.guard';
import { ActiveTenant } from '../../../dashboard-identity/infrastructure/decorators/active-tenant.decorator';
import {
  RecordIntegrationConnectionDto,
  UpsertMainApiConnectionDto,
} from './dto/upsert-main-api-connection.dto';

@Controller('dashboard-api/erp/main-api-connection')
@ApiTags('Dashboard ERP connection (Mode B)')
@UseGuards(DashboardJwtAuthGuard, ActiveTenantGuard)
@ApiBearerAuth()
export class MainApiConnectionController {
  constructor(
    private readonly connections: MainApiConnectionApplicationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Get this tenant's main-API connection status (apiKey masked)",
  })
  @ApiResponse({ status: 200, description: 'Connection status' })
  async getStatus(@ActiveTenant() tenantId: string) {
    const status = await this.connections.getStatus(tenantId);
    return { success: true, message: 'OK', data: status };
  }

  @Put()
  @ApiOperation({
    summary:
      'Save this main-API Application id + api key so items/invoices can be pulled',
  })
  @ApiResponse({ status: 200, description: 'Connection saved' })
  async upsert(
    @ActiveTenant() tenantId: string,
    @Body() body: UpsertMainApiConnectionDto,
  ) {
    await this.connections.upsert(tenantId, {
      mainApiApplicationId: body.mainApiApplicationId,
      mainApiApiKey: body.mainApiApiKey,
    });
    // Auto-creates the main-API Company on first save, per the documented
    // flow — no manual companyId entry needed (concepts/companies-and-connections.mdx).
    await this.connections.ensureCompany(tenantId);
    const status = await this.connections.getStatus(tenantId);
    return { success: true, message: 'Connection saved', data: status };
  }

  @Post('record-connection')
  @ApiOperation({
    summary:
      "Record a successful widget connect for one integration (called from the widget's onSuccess)",
  })
  @ApiResponse({ status: 200, description: 'Connection recorded' })
  async recordConnection(
    @ActiveTenant() tenantId: string,
    @Body() body: RecordIntegrationConnectionDto,
  ) {
    await this.connections.recordConnection(
      tenantId,
      body.integrationKey,
      body.connectionId,
    );
    const status = await this.connections.getStatus(tenantId);
    return { success: true, message: 'Connection recorded', data: status };
  }

  @Get('link-credentials')
  @ApiOperation({
    summary:
      'UNMASKED config for the Sync2BooksLink widget (useSync2Books), per link-integration.mdx. ' +
      'The documented React integration passes apiKey client-side — that is a deliberate, ' +
      'accepted tradeoff of following the widget as documented, not an oversight.',
  })
  @ApiResponse({ status: 200, description: 'Widget config' })
  async getLinkCredentials(@ActiveTenant() tenantId: string) {
    const credentials = await this.connections.getLinkCredentials(tenantId);
    return { success: true, message: 'OK', data: credentials };
  }
}
