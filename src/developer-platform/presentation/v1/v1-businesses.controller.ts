import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';
import type { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { API_KEY_HEADER } from '../../domain/api-key';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import {
  ApiTenantId,
  AuthenticatedApiCaller,
} from '../../infrastructure/decorators/api-caller.decorator';
import { RequireScopes } from '../../infrastructure/decorators/require-scopes.decorator';
import { ApiRateLimitGuard } from '../../infrastructure/guards/api-rate-limit.guard';
import type { ApiCaller } from '../../infrastructure/guards/api-caller';
import { ComplianceApiKeyGuard } from '../../infrastructure/guards/compliance-api-key.guard';
import { TenantScopeGuard } from '../../infrastructure/guards/tenant-scope.guard';

/**
 * The entry point of the public API: who a key is, and which businesses it can
 * reach. Everything else on `/v1` lands in the next phase, but these two are
 * what a developer calls first to confirm their key works and to discover the
 * business ids the rest of the API takes.
 *
 * Guard order matters and is the same on every `/v1` controller:
 * authenticate → count against the limit → bind to a business.
 */
@Controller('v1/businesses')
@ApiTags('Compliance API v1')
@ApiSecurity(API_KEY_HEADER)
@UseGuards(ComplianceApiKeyGuard, ApiRateLimitGuard, TenantScopeGuard)
export class V1BusinessesController {
  constructor(
    private readonly organizations: ComplianceOrganizationApplicationService,
  ) {}

  @Get()
  @RequireScopes(ApiKeyScope.LOOKUPS_READ)
  @ApiOperation({
    summary: 'Businesses this key can act for, in this key’s environment',
  })
  async list(@AuthenticatedApiCaller() caller: ApiCaller) {
    const tenants = await this.organizations.listTenantsByOrganizationId(
      caller.organizationId,
    );

    // Filtered by environment, not merely flagged: a test key listing live
    // businesses would invite exactly the mistake TenantScopeGuard then refuses.
    const businesses: Array<{
      id: string;
      displayName: string | null;
      environment: ConnectionEnvironment;
    }> = [];
    for (const tenant of tenants) {
      const environment = await this.organizations.getTenantEnvironment(
        tenant.id,
      );
      if (environment !== caller.environment) continue;
      businesses.push({
        id: tenant.id,
        displayName: tenant.displayName,
        environment,
      });
    }

    return { success: true, message: 'OK', data: { businesses } };
  }

  @Get(':businessId')
  @RequireScopes(ApiKeyScope.LOOKUPS_READ)
  @ApiOperation({ summary: 'One business, with its branches' })
  async get(
    @Param('businessId') _businessId: string,
    @ApiTenantId() tenantId: string,
  ) {
    // `_businessId` is what the caller sent; `tenantId` is what
    // TenantScopeGuard resolved and allowed. Only the resolved one is used —
    // the raw param has already done its job by naming the business.
    const tenant = await this.organizations.getTenantById(tenantId);
    const branches = await this.organizations.listBranches(tenantId);
    const environment = await this.organizations.getTenantEnvironment(tenantId);

    return {
      success: true,
      message: 'OK',
      data: {
        business: {
          id: tenantId,
          displayName: tenant?.displayName ?? null,
          environment,
          branches: branches.map((b) => ({
            id: b.id,
            kraBhfId: b.kraBhfId,
            displayName: b.displayName,
            tradeAddressLine1: b.tradeAddressLine1 ?? null,
            tradeCity: b.tradeCity ?? null,
          })),
        },
      },
    };
  }
}
