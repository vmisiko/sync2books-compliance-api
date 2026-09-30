import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ComplianceOrganizationApplicationService } from '../../../compliance-organization/application/compliance-organization.application.service';
import type { ConnectionEnvironment } from '../../../shared/domain/enums/connection-environment.enum';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import {
  ApiTenantId,
  AuthenticatedApiCaller,
} from '../../infrastructure/decorators/api-caller.decorator';
import { RequireScopes } from '../../infrastructure/decorators/require-scopes.decorator';
import type { ApiCaller } from '../../infrastructure/guards/api-caller';
import { V1Api } from './v1-api.decorator';

/**
 * The businesses a key can reach. A developer calls this first, after
 * `/v1/me`, to discover the business ids every other route takes.
 */
@Controller('v1/businesses')
@V1Api()
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

    return { data: { businesses } };
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

  @Get(':businessId/branches')
  @RequireScopes(ApiKeyScope.LOOKUPS_READ)
  @ApiOperation({ summary: "A business's branches" })
  async branches(
    @Param('businessId') _businessId: string,
    @ApiTenantId() tenantId: string,
  ) {
    const branches = await this.organizations.listBranches(tenantId);
    return {
      data: {
        branches: branches.map((b) => ({
          id: b.id,
          kraBhfId: b.kraBhfId,
          displayName: b.displayName,
          tradeAddressLine1: b.tradeAddressLine1 ?? null,
          tradeCity: b.tradeCity ?? null,
        })),
      },
    };
  }
}
