import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import type { DashboardRequestUser } from '../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';
import { CreateBusinessDto } from './dto/create-business.dto';
import { getGlobalMainApiCredentials } from '../../shared/config/main-api-app-credentials';

export type BusinessSummaryResponse = {
  id: string;
  displayName: string | null;
  merchantId: string;
  kraPin: string | null;
  environment: string | null;
  dvcSrlNo: string | null;
  status: string | null;
};

@Controller('dashboard-api/businesses')
@ApiTags('Dashboard businesses (Mode B)')
@UseGuards(DashboardJwtAuthGuard)
@ApiBearerAuth()
export class DashboardBusinessController {
  constructor(
    private readonly organizations: ComplianceOrganizationApplicationService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List the caller's organisation's businesses" })
  @ApiResponse({ status: 200, description: 'Business list' })
  async list(@Req() req: Request) {
    const user = req.user as DashboardRequestUser;
    const tenants = await this.organizations.listTenantsByOrganizationId(
      user.organizationId,
    );
    const businesses: BusinessSummaryResponse[] = await Promise.all(
      tenants.map(async (tenant) => {
        const summary = await this.organizations.getTenantSummary(tenant.id);
        return {
          id: tenant.id,
          displayName: tenant.displayName,
          merchantId: tenant.sync2booksCompanyId ?? tenant.id,
          kraPin: summary?.etimsConnection?.kraPin ?? null,
          environment: summary?.etimsConnection?.environment ?? null,
          dvcSrlNo: summary?.etimsConnection?.dvcSrlNo ?? null,
          status: summary?.etimsConnection?.status ?? null,
        };
      }),
    );
    return { success: true, message: 'OK', data: { businesses } };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Add a business (PIN No., display name, Live/Test) under the caller's organisation. " +
      'Also creates the matching main-API Company under the shared Main API Application.',
  })
  @ApiResponse({ status: 201, description: 'Business created' })
  async create(@Req() req: Request, @Body() body: CreateBusinessDto) {
    const user = req.user as DashboardRequestUser;

    const { tenant } = await this.organizations.upsertTenant({
      displayName: body.displayName,
      kraPin: body.kraPin,
      isLiveBusiness: body.isLiveBusiness,
      organizationId: user.organizationId,
    });

    await this.mainApiConnections.upsert(
      tenant.id,
      getGlobalMainApiCredentials(),
    );
    // ensureCompany() stamps sync2booksCompanyId onto the tenant itself now
    // (see MainApiConnectionApplicationService.ensureCompanyLocked) — no
    // need to re-upsert it here too.
    await this.mainApiConnections.ensureCompany(tenant.id);
    const healed = await this.organizations.getTenantById(tenant.id);
    const merchantId = healed?.sync2booksCompanyId ?? tenant.id;

    const summary = await this.organizations.getTenantSummary(tenant.id);
    const business: BusinessSummaryResponse = {
      id: tenant.id,
      displayName: tenant.displayName,
      merchantId,
      kraPin: summary?.etimsConnection?.kraPin ?? null,
      environment: summary?.etimsConnection?.environment ?? null,
      dvcSrlNo: summary?.etimsConnection?.dvcSrlNo ?? null,
      status: summary?.etimsConnection?.status ?? null,
    };
    return { success: true, message: 'Business created', data: { business } };
  }
}
