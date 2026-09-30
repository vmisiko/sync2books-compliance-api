import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { AuthenticatedApiCaller } from '../../infrastructure/decorators/api-caller.decorator';
import type { ApiCaller } from '../../infrastructure/guards/api-caller';
import { V1Api } from './v1-api.decorator';

/**
 * "Is my key working, and what can it do?" — the first call a developer makes,
 * and the one support asks for when a key misbehaves.
 *
 * Carries no scope requirement on purpose: a key with the wrong scopes still
 * needs to be able to find out what it has.
 */
@Controller('v1/me')
@V1Api({ bindsBusiness: false })
export class V1MeController {
  @Get()
  @ApiOperation({ summary: 'The application and permissions behind this key' })
  me(@AuthenticatedApiCaller() caller: ApiCaller) {
    return {
      data: {
        applicationId: caller.applicationId,
        environment: caller.environment,
        scopes: caller.scopes,
        rateLimitPerMin: caller.rateLimitPerMin,
      },
    };
  }
}
