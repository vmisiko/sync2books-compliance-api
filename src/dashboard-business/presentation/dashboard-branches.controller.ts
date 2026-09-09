import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DashboardBranchesApplicationService } from '../application/dashboard-branches.application.service';
import { ActiveTenant } from '../../dashboard-identity/infrastructure/decorators/active-tenant.decorator';
import { ActiveTenantGuard } from '../../dashboard-identity/infrastructure/guards/active-tenant.guard';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';

@Controller('dashboard-api/branches')
@ApiTags('Dashboard branches (Mode B)')
@UseGuards(DashboardJwtAuthGuard, ActiveTenantGuard)
@ApiBearerAuth()
export class DashboardBranchesController {
  constructor(private readonly branches: DashboardBranchesApplicationService) {}

  @Get()
  @ApiOperation({
    summary:
      "List this business's branches. Same rows as GET /dashboard-api/inventory/branches, which predates this controller and stays for compatibility.",
  })
  @ApiResponse({ status: 200, description: 'Branch list' })
  async list(@ActiveTenant() tenantId: string) {
    const branches = await this.branches.list(tenantId);
    return { success: true, message: 'OK', data: { branches } };
  }

  @Post('pull')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pull the real branch list for this business from KRA (OSCU branchList) and upsert it locally, keyed by bhfId. Requires an initialized eTIMS connection on at least one branch.',
  })
  @ApiResponse({ status: 200, description: 'Pull result' })
  async pull(@ActiveTenant() tenantId: string) {
    const result = await this.branches.pullFromEtims(tenantId);
    const message =
      result.fetched === 0
        ? 'KRA returned no branches for this PIN'
        : `${result.fetched} branch(es) from KRA — ${result.created} added, ${result.updated} updated`;
    return { success: true, message, data: result };
  }
}
