import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { MainApiConnectionApplicationService } from '../application/main-api-connection.application.service';
import {
  MainApiPullClient,
  type MainApiIntegrationKey,
} from '../infrastructure/http/main-api-pull.client';
import { DashboardJwtAuthGuard } from '../../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import type { DashboardRequestUser } from '../../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';
import { ConnectOdooDto } from './dto/connect-odoo.dto';
import { FinalizeDynamicsDto } from './dto/finalize-dynamics.dto';
import { RecordConnectionDto } from './dto/record-connection.dto';

/**
 * Backend proxy for the Sync2BooksLink connect widget (ported from
 * sync2books-react's src/lib/sync2books-link). The widget's own `apiKey` prop
 * mode calls the main API directly from the browser — that's flagged
 * "dev-only" by its own authors. This controller is the production-safe
 * path: the dashboard passes override props that hit these Mode B routes
 * instead, so the tenant's main-API key never leaves this server.
 */
@Controller('dashboard-api/erp/link')
@ApiTags('Dashboard ERP connect widget (Mode B)')
@UseGuards(DashboardJwtAuthGuard)
@ApiBearerAuth()
export class ErpLinkController {
  constructor(
    private readonly connections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
  ) {}

  @Get('auth-url')
  @ApiOperation({
    summary: 'Get the OAuth authorization URL for an integration',
  })
  @ApiQuery({ name: 'integrationKey', required: true })
  @ApiQuery({ name: 'connectionId', required: false })
  async getAuthUrl(
    @Req() req: Request,
    @Query('integrationKey') integrationKey: MainApiIntegrationKey,
    @Query('connectionId') connectionId?: string,
  ) {
    const { apiKey, companyId } = await this.resolve(req);
    return this.mainApiPull.getAuthUrl(
      apiKey,
      companyId,
      integrationKey,
      connectionId,
    );
  }

  @Get('connection')
  @ApiOperation({
    summary: 'Get the current connection for an integration (or null)',
  })
  @ApiQuery({ name: 'integrationKey', required: true })
  async getConnection(
    @Req() req: Request,
    @Query('integrationKey') integrationKey: MainApiIntegrationKey,
  ) {
    const { apiKey, companyId } = await this.resolve(req);
    return this.mainApiPull.getConnectionByIntegration(
      apiKey,
      companyId,
      integrationKey,
    );
  }

  @Get('dynamics/:connectionId/companies')
  @ApiOperation({
    summary: 'List Business Central companies for a Dynamics connection',
  })
  async listDynamicsCompanies(
    @Req() req: Request,
    @Param('connectionId') connectionId: string,
  ) {
    const { apiKey } = await this.resolve(req);
    return this.mainApiPull.listDynamicsCompanies(apiKey, connectionId);
  }

  @Post('dynamics/:connectionId/finalize')
  @ApiOperation({
    summary:
      'Finish a Dynamics connection by choosing a Business Central company',
  })
  async finalizeDynamics(
    @Req() req: Request,
    @Param('connectionId') connectionId: string,
    @Body() body: FinalizeDynamicsDto,
  ) {
    const { apiKey } = await this.resolve(req);
    return this.mainApiPull.finalizeDynamicsConnection(
      apiKey,
      connectionId,
      body.bookCompanyId,
    );
  }

  @Post('odoo/connect')
  @ApiOperation({
    summary: 'Connect Odoo (no OAuth — credentials validated synchronously)',
  })
  async connectOdoo(@Req() req: Request, @Body() body: ConnectOdooDto) {
    const { apiKey, companyId } = await this.resolve(req);
    return this.mainApiPull.connectOdoo(
      apiKey,
      companyId,
      {
        url: body.url,
        database: body.database,
        username: body.username,
        apiKey: body.apiKey,
      },
      body.connectionId,
    );
  }

  @Post(':connectionId/disconnect')
  @ApiOperation({ summary: 'Disconnect a connection' })
  async disconnect(
    @Req() req: Request,
    @Param('connectionId') connectionId: string,
  ) {
    const { apiKey } = await this.resolve(req);
    return this.mainApiPull.disconnectConnection(apiKey, connectionId);
  }

  @Post('record-connection')
  @ApiOperation({
    summary:
      'Remember the connectionId from a successful Sync2BooksLink connect, so items/invoices pulls can trigger a fresh bookkeeping sync',
  })
  async recordConnection(
    @Req() req: Request,
    @Body() body: RecordConnectionDto,
  ) {
    const user = req.user as DashboardRequestUser;
    await this.connections.recordConnection(
      user.tenantId,
      body.integrationKey,
      body.connectionId,
    );
    return { success: true, message: 'Connection recorded' };
  }

  private async resolve(
    req: Request,
  ): Promise<{ apiKey: string; companyId: string }> {
    const user = req.user as DashboardRequestUser;
    // ensureCompany (not getForTenant) so a mainApiCompanyId that was deleted
    // or never created on the main API side gets (re)created here, before
    // any auth-url/connect call is attempted against it.
    const connection = await this.connections.ensureCompany(user.tenantId);
    if (!connection.mainApiCompanyId) {
      throw new BadRequestException(
        'This tenant has no mainApiCompanyId configured — set it on the ERP connection before connecting an integration',
      );
    }
    return {
      apiKey: connection.mainApiApiKey,
      companyId: connection.mainApiCompanyId,
    };
  }
}
