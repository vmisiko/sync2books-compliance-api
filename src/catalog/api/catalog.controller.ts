import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { RegisterCatalogItemDto } from './dto/register-catalog-item.dto';
import { SyncCatalogItemsDto } from './dto/sync-catalog-items.dto';
import { ComplianceServiceAuthGuard } from '../../integration/compliance-service-auth.guard';
import { PlatformOscuCallbackService } from '../../integration/platform-outbound/platform-oscu-callback.service';
import { Sync2BooksCorrelationPersistenceService } from '../../integration/platform-outbound/sync2books-correlation-persistence.service';
import { parseSync2BooksCorrelation } from '../../integration/platform-outbound/sync2books-request-headers.util';

@Controller('catalog')
@ApiTags('Catalog')
@UseGuards(ComplianceServiceAuthGuard)
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly oscuCallback: PlatformOscuCallbackService,
    private readonly correlationPersistence: Sync2BooksCorrelationPersistenceService,
  ) {}

  @Post('items')
  @ApiOperation({ summary: 'Create or update compliance item' })
  @ApiResponse({ status: 201, description: 'Item created or updated' })
  async registerItem(
    @Body()
    body: RegisterCatalogItemDto,
    @Req() req: Request,
  ) {
    const result = await this.catalogService.registerItem(body);
    const corr = parseSync2BooksCorrelation(req);
    if (corr) {
      await this.correlationPersistence.patchCatalogItem(result.item.id, corr);
      await this.oscuCallback.postOutcomeWithCorrelation(corr, {
        channel: 'CATALOG_REGISTER',
        aggregateStatus: 'INFO',
        complianceStatus: result.item.registrationStatus,
        eventId: randomUUID(),
        raw: { catalogItemId: result.item.id },
      });
    }
    return result;
  }

  @Get('merchants/:merchantId/items')
  @ApiOperation({ summary: 'List compliance items' })
  @ApiResponse({ status: 200, description: 'Item list' })
  async listItems(@Param('merchantId') merchantId: string) {
    return this.catalogService.listItems(merchantId);
  }

  @Post('items/sync')
  @ApiOperation({ summary: 'Sync catalog items to eTIMS (register/update)' })
  @ApiResponse({ status: 201, description: 'Items synced' })
  async syncItems(
    @Body()
    body: SyncCatalogItemsDto,
    @Req() req: Request,
  ) {
    const result = await this.catalogService.syncItems(body);
    const corr = parseSync2BooksCorrelation(req);
    if (corr && result.results.length > 0) {
      const ids = result.results.map((r) => r.itemId);
      await this.correlationPersistence.patchCatalogItems(ids, corr);

      const aggregateStatus =
        result.failed > 0
          ? result.synced > 0
            ? 'PARTIAL'
            : 'FAILED'
          : 'SUCCESS';

      await this.oscuCallback.postOutcomeWithCorrelation(corr, {
        channel: 'CATALOG_SYNC_BATCH',
        aggregateStatus,
        catalogItemResults: result.results.map((r) => ({
          catalogItemId: r.itemId,
          success: r.success,
          resultCd: r.resultCd,
          resultMsg: r.resultMsg,
        })),
        eventId: randomUUID(),
        raw: {
          merchantId: result.merchantId,
          branchId: result.branchId,
          attempted: result.attempted,
          synced: result.synced,
          failed: result.failed,
        },
      });
    }
    return result;
  }
}
