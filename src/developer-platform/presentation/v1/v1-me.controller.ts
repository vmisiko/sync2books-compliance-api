import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { API_KEY_HEADER } from '../../domain/api-key';
import { AuthenticatedApiCaller } from '../../infrastructure/decorators/api-caller.decorator';
import { ApiRateLimitGuard } from '../../infrastructure/guards/api-rate-limit.guard';
import type { ApiCaller } from '../../infrastructure/guards/api-caller';
import { ComplianceApiKeyGuard } from '../../infrastructure/guards/compliance-api-key.guard';

/**
 * "Is my key working, and what can it do?" — the first call a developer makes,
 * and the one support asks for when a key misbehaves.
 *
 * Carries no scope requirement on purpose: a key with the wrong scopes still
 * needs to be able to find out what it has.
 */
@Controller('v1/me')
@ApiTags('Compliance API v1')
@ApiSecurity(API_KEY_HEADER)
@UseGuards(ComplianceApiKeyGuard, ApiRateLimitGuard)
export class V1MeController {
  @Get()
  @ApiOperation({ summary: 'The application and permissions behind this key' })
  me(@AuthenticatedApiCaller() caller: ApiCaller) {
    return {
      success: true,
      message: 'OK',
      data: {
        applicationId: caller.applicationId,
        environment: caller.environment,
        scopes: caller.scopes,
        rateLimitPerMin: caller.rateLimitPerMin,
      },
    };
  }
}
