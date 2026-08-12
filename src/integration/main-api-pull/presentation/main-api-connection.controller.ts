import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { MainApiConnectionApplicationService } from '../application/main-api-connection.application.service';
import { DashboardJwtAuthGuard } from '../../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import type { DashboardRequestUser } from '../../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';
import { UpsertMainApiConnectionDto } from './dto/upsert-main-api-connection.dto';

@Controller('dashboard-api/erp/main-api-connection')
@ApiTags('Dashboard ERP connection (Mode B)')
@UseGuards(DashboardJwtAuthGuard)
@ApiBearerAuth()
export class MainApiConnectionController {
  constructor(private readonly connections: MainApiConnectionApplicationService) {}

  @Get()
  @ApiOperation({
    summary: "Get this tenant's main-API connection status (apiKey masked)",
  })
  @ApiResponse({ status: 200, description: 'Connection status' })
  async getStatus(@Req() req: Request) {
    const user = req.user as DashboardRequestUser;
    const status = await this.connections.getStatus(user.tenantId);
    return { success: true, message: 'OK', data: status };
  }

  @Put()
  @ApiOperation({
    summary:
      'Save this main-API Application id + api key so items/invoices can be pulled',
  })
  @ApiResponse({ status: 200, description: 'Connection saved' })
  async upsert(@Req() req: Request, @Body() body: UpsertMainApiConnectionDto) {
    const user = req.user as DashboardRequestUser;
    await this.connections.upsert(user.tenantId, {
      mainApiApplicationId: body.mainApiApplicationId,
      mainApiApiKey: body.mainApiApiKey,
      quickbooksConnectionId: body.quickbooksConnectionId ?? null,
    });
    const status = await this.connections.getStatus(user.tenantId);
    return { success: true, message: 'Connection saved', data: status };
  }
}
