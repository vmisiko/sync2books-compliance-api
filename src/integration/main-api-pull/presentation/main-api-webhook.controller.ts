import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { MainApiConnectionApplicationService } from '../application/main-api-connection.application.service';

interface InboundWebhookBody {
  id: string;
  eventType: string;
  generatedDate: string;
  payload: Record<string, unknown>;
}

/**
 * Receives connection.* webhooks from the main Sync2Books API — see
 * WEBHOOK_SYSTEM.md in nest-sync-2-books-api for the sender side. Public
 * route (no DashboardJwtAuthGuard): the main API is not a dashboard user and
 * carries no such JWT. Authenticity instead comes entirely from the
 * per-tenant HMAC signature registered via POST /webhooks/endpoints.
 */
@Controller('webhooks/main-api/connections')
@ApiTags('Inbound main-API webhooks')
export class MainApiWebhookController {
  private readonly logger = new Logger(MainApiWebhookController.name);

  constructor(private readonly connections: MainApiConnectionApplicationService) {}

  @Post(':complianceTenantId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inbound connection.* webhook for one compliance tenant' })
  @ApiParam({ name: 'complianceTenantId' })
  async receive(
    @Param('complianceTenantId') complianceTenantId: string,
    @Body() body: InboundWebhookBody,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body));

    const result = await this.connections.handleInboundWebhookEvent(
      complianceTenantId,
      rawBody,
      signature,
      body?.id,
      body?.eventType,
      body?.payload ?? {},
    );

    if (result === 'unknown_tenant') {
      // 200, not 404: an unregistered tenant is not something the sender should
      // retry — but we also don't want to reveal tenant existence via status code.
      this.logger.warn(`Webhook for unknown/unconfigured tenant ${complianceTenantId} (event ${body?.eventType})`);
      return { received: true };
    }
    if (result === 'bad_signature') {
      this.logger.warn(`Rejected webhook for tenant ${complianceTenantId}: bad signature`);
      // Real 401 (not a 200 with received:false) so a genuine signature
      // mismatch shows up as a failed delivery in the main API's own
      // webhook stats/retry logic, instead of looking like success.
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return { received: true };
  }
}
