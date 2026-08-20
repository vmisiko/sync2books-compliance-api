import { Body, Controller, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DashboardOrganizationApplicationService } from '../../dashboard-organization/application/dashboard-organization.application.service';
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import type { DashboardRequestUser } from '../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

/**
 * Org-level settings (currently just displayName). Lives in dashboard-business
 * rather than dashboard-organization because it needs DashboardJwtAuthGuard,
 * and dashboard-organization deliberately never imports DashboardIdentityModule
 * (that module already imports dashboard-organization for signup -- see its
 * own module file for the circular-import note).
 */
@Controller('dashboard-api/organizations')
@ApiTags('Dashboard organization settings (Mode B)')
@UseGuards(DashboardJwtAuthGuard)
@ApiBearerAuth()
export class DashboardOrganizationSettingsController {
  constructor(
    private readonly organizations: DashboardOrganizationApplicationService,
  ) {}

  @Patch()
  @ApiOperation({ summary: "Update the caller's organisation display name" })
  async update(@Req() req: Request, @Body() body: UpdateOrganizationDto) {
    const requestUser = req.user as DashboardRequestUser;
    const organization = await this.organizations.updateDisplayName(
      requestUser.organizationId,
      body.displayName,
    );
    return {
      success: true,
      message: 'Organization updated',
      data: { organization: { id: organization.id, displayName: organization.displayName } },
    };
  }
}
