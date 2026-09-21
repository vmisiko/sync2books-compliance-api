import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { DashboardJwtAuthGuard } from '../../dashboard-identity/infrastructure/guards/dashboard-jwt-auth.guard';
import type { DashboardRequestUser } from '../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';
import { DeveloperPlatformApplicationService } from '../application/developer-platform.application.service';
import { ALL_API_KEY_SCOPES } from '../domain/api-key-scope.enum';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';

/**
 * Where a merchant's admin issues the keys their own developer will use.
 *
 * Signed-in dashboard routes, so the organisation comes from the session and
 * never from the request — the service re-checks it on every call regardless,
 * because ownership is not something a controller should be trusted to have
 * done.
 */
@Controller('dashboard-api/developer')
@ApiTags('Developer platform (dashboard)')
@UseGuards(DashboardJwtAuthGuard)
@ApiBearerAuth()
export class DeveloperPlatformController {
  constructor(private readonly platform: DeveloperPlatformApplicationService) {}

  @Get('scopes')
  @ApiOperation({ summary: 'The scopes an API key can be granted' })
  listScopes() {
    return {
      success: true,
      message: 'OK',
      data: { scopes: ALL_API_KEY_SCOPES },
    };
  }

  @Get('applications')
  @ApiOperation({ summary: "List the organisation's integration applications" })
  async listApplications(@Req() req: Request) {
    const user = req.user as DashboardRequestUser;
    const applications = await this.platform.listApplications(
      user.organizationId,
    );
    return { success: true, message: 'OK', data: { applications } };
  }

  @Post('applications')
  @ApiOperation({ summary: 'Create an integration application' })
  @ApiResponse({ status: 201, description: 'The created application' })
  async createApplication(
    @Req() req: Request,
    @Body() dto: CreateApplicationDto,
  ) {
    const user = req.user as DashboardRequestUser;
    const application = await this.platform.createApplication({
      organizationId: user.organizationId,
      name: dto.name,
      description: dto.description ?? null,
      createdByUserId: user.userId,
    });
    return { success: true, message: 'Application created', data: { application } };
  }

  @Patch('applications/:applicationId')
  @ApiOperation({ summary: 'Rename, suspend, or re-limit an application' })
  async updateApplication(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @Body() dto: UpdateApplicationDto,
  ) {
    const user = req.user as DashboardRequestUser;
    const application = await this.platform.updateApplication({
      organizationId: user.organizationId,
      applicationId,
      name: dto.name,
      description: dto.description,
      status: dto.status,
      rateLimitPerMin: dto.rateLimitPerMin,
    });
    return { success: true, message: 'Application updated', data: { application } };
  }

  @Get('applications/:applicationId/keys')
  @ApiOperation({ summary: "An application's API keys (never their secrets)" })
  async listKeys(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
  ) {
    const user = req.user as DashboardRequestUser;
    const keys = await this.platform.listKeys(
      user.organizationId,
      applicationId,
    );
    return { success: true, message: 'OK', data: { keys } };
  }

  @Post('applications/:applicationId/keys')
  @ApiOperation({ summary: 'Issue an API key' })
  @ApiResponse({
    status: 201,
    description:
      'The key, plus its secret. The secret is not stored and is never returned again.',
  })
  async createKey(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    const user = req.user as DashboardRequestUser;
    const created = await this.platform.createKey({
      organizationId: user.organizationId,
      applicationId,
      environment: dto.environment,
      name: dto.name ?? null,
      scopes: dto.scopes,
      expiresAt: parseExpiry(dto.expiresAt),
      createdByUserId: user.userId,
    });
    return {
      success: true,
      message: 'API key created. Copy it now — it is not shown again.',
      data: created,
    };
  }

  @Post('keys/:apiKeyId/rotate')
  @ApiOperation({
    summary: 'Issue a replacement key and revoke this one',
  })
  async rotateKey(@Req() req: Request, @Param('apiKeyId') apiKeyId: string) {
    const user = req.user as DashboardRequestUser;
    const created = await this.platform.rotateKey({
      organizationId: user.organizationId,
      apiKeyId,
      rotatedByUserId: user.userId,
    });
    return {
      success: true,
      message:
        'API key rotated. The previous key is revoked — copy the new one now.',
      data: created,
    };
  }

  @Post('keys/:apiKeyId/revoke')
  @ApiOperation({ summary: 'Revoke an API key immediately' })
  async revokeKey(@Req() req: Request, @Param('apiKeyId') apiKeyId: string) {
    const user = req.user as DashboardRequestUser;
    const key = await this.platform.revokeKey({
      organizationId: user.organizationId,
      apiKeyId,
      revokedByUserId: user.userId,
    });
    return { success: true, message: 'API key revoked', data: { key } };
  }
}

function parseExpiry(raw: string | undefined): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('expiresAt must be an ISO-8601 date');
  }
  return parsed;
}
