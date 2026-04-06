import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ComplianceOrganizationApplicationService } from '../application/compliance-organization.application.service';
import { UpsertBranchDto } from './dto/upsert-branch.dto';
import { UpsertEtimsConnectionDto } from './dto/upsert-etims-connection.dto';
import { TenantUpsertResponseDto } from './dto/tenant-upsert-response.dto';
import { UpsertTenantDto } from './dto/upsert-tenant.dto';

@Controller('compliance-organization')
@ApiTags('Compliance organization')
export class ComplianceOrganizationController {
  constructor(
    private readonly organization: ComplianceOrganizationApplicationService,
  ) {}

  @Post('tenants')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create or update a compliance tenant (new tenants get a default Headquarters branch). Send `kraPin` (+ Test/Live) to also upsert the eTIMS shell on that branch.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Tenant upserted; includes default branch id and optional eTIMS row',
    type: TenantUpsertResponseDto,
  })
  async upsertTenant(@Body() body: UpsertTenantDto) {
    return this.organization.upsertTenant({
      id: body.id,
      sync2booksCompanyId: body.sync2booksCompanyId,
      displayName: body.displayName,
    });
  }

  @Get('tenants/by-sync2books/:sync2booksCompanyId')
  @ApiOperation({ summary: 'Get tenant by Sync2Books company id' })
  @ApiResponse({ status: 200, description: 'Tenant or 404' })
  async getTenantBySync2books(
    @Param('sync2booksCompanyId') sync2booksCompanyId: string,
  ) {
    const tenant =
      await this.organization.getTenantBySync2booksCompanyId(
        sync2booksCompanyId,
      );
    if (!tenant) {
      throw new NotFoundException(
        `Tenant not found for company ${sync2booksCompanyId}`,
      );
    }
    return tenant;
  }

  @Get('tenants/:tenantId')
  @ApiOperation({ summary: 'Get tenant by internal id' })
  async getTenantById(@Param('tenantId') tenantId: string) {
    const tenant = await this.organization.getTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
    return tenant;
  }

  @Post('tenants/:tenantId/branches')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create or update a branch under a tenant' })
  async upsertBranch(
    @Param('tenantId') tenantId: string,
    @Body() body: UpsertBranchDto,
  ) {
    const tenant = await this.organization.getTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
    return this.organization.upsertBranch({
      tenantId,
      id: body.id,
      sync2booksBranchId: body.sync2booksBranchId,
      displayName: body.displayName,
      kraBhfId: body.kraBhfId,
    });
  }

  @Get('tenants/:tenantId/branches')
  @ApiOperation({ summary: 'List branches for a tenant' })
  async listBranches(@Param('tenantId') tenantId: string) {
    const tenant = await this.organization.getTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
    return this.organization.listBranches(tenantId);
  }

  @Put('branches/:branchId/etims-connection')
  @ApiOperation({
    summary:
      'Create or update eTIMS connection shell (kraPin, environment, etc.). OSCU deviceId/cmcKey are set only after initialize, not from this body.',
  })
  async upsertEtimsConnection(
    @Param('branchId') branchId: string,
    @Body() body: UpsertEtimsConnectionDto,
  ) {
    const branch = await this.organization.getBranchById(branchId);
    if (!branch) {
      throw new NotFoundException(`Branch ${branchId} not found`);
    }
    return this.organization.upsertEtimsConnection({
      complianceBranchId: branchId,
      kraPin: body.kraPin,
      dvcSrlNo: body.dvcSrlNo,
      environment: body.environment,
      status: body.status,
      sync2booksConnectionId: body.sync2booksConnectionId,
    });
  }

  @Post('branches/:branchId/etims-connection/initialize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Call OSCU initialize using stored connection (kraPin, dvcSrlNo) and branch kraBhfId; persist cmcKey + dvcId from response. No body — branch id in path only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Connection updated after initialize',
  })
  async initializeEtimsConnection(@Param('branchId') branchId: string) {
    const branch = await this.organization.getBranchById(branchId);
    if (!branch) {
      throw new NotFoundException(`Branch ${branchId} not found`);
    }
    return this.organization.initializeEtimsConnection({
      complianceBranchId: branchId,
    });
  }
}
