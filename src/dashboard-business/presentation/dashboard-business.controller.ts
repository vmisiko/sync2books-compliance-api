import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { DashboardOrganizationApplicationService } from '../../dashboard-organization/application/dashboard-organization.application.service';
import { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import type { DashboardRequestUser } from '../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';
import { CreateBusinessDto } from './dto/create-business.dto';

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
    private readonly dashboardOrganizations: DashboardOrganizationApplicationService,
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
      'Add a business (PIN No., display name, Live/Test) under the caller\'s organisation. ' +
      'Also creates the matching main-API Company when the org has a provisioned apiKey.',
  })
  @ApiResponse({ status: 201, description: 'Business created' })
  async create(@Req() req: Request, @Body() body: CreateBusinessDto) {
    const user = req.user as DashboardRequestUser;
    const organization = await this.dashboardOrganizations.getById(
      user.organizationId,
    );

    const { tenant } = await this.organizations.upsertTenant({
      displayName: body.displayName,
      kraPin: body.kraPin,
      isLiveBusiness: body.isLiveBusiness,
      organizationId: user.organizationId,
    });

    let merchantId = tenant.sync2booksCompanyId ?? tenant.id;
    if (organization.mainApiApiKey && organization.mainApiApplicationId) {
      await this.mainApiConnections.upsert(tenant.id, {
        mainApiApplicationId: organization.mainApiApplicationId,
        mainApiApiKey: organization.mainApiApiKey,
      });
      const connection = await this.mainApiConnections.ensureCompany(tenant.id);
      if (connection.mainApiCompanyId) {
        const stamped = await this.organizations.upsertTenant({
          id: tenant.id,
          sync2booksCompanyId: connection.mainApiCompanyId,
        });
        merchantId = stamped.tenant.sync2booksCompanyId ?? tenant.id;
      }
    }

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
