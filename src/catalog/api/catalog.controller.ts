import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'crypto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { RegisterCatalogItemDto } from './dto/register-catalog-item.dto';
import { SyncCatalogItemsDto } from './dto/sync-catalog-items.dto';
import { SearchItemClassificationsQueryDto } from './dto/search-item-classifications.dto';
import { SyncItemClassificationsDto } from './dto/sync-item-classifications.dto';
import {
  ListCodeClassesQueryDto,
  SearchCodesQueryDto,
} from './dto/search-codes.dto';
import { SyncCodeListDto } from './dto/sync-code-list.dto';
import { SyncReferenceDataNowDto } from './dto/sync-reference-data-now.dto';
import { ResyncOscuSequenceDto } from './dto/resync-oscu-sequence.dto';
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

  @Post('items/resync-item-cd-sequence')
  @ApiOperation({
    summary:
      'Recover the true itemCd sequence for this tin directly from KRA (/itemInfo) instead of guessing, and backfill any local item KRA already has registered',
  })
  @ApiResponse({ status: 201, description: 'Sequence resynced' })
  async resyncItemCdSequence(@Body() body: ResyncOscuSequenceDto) {
    return this.catalogService.resyncItemCdSequenceFromKra(body);
  }

  @Get('item-classifications')
  @ApiOperation({
    summary:
      'Search OSCU item classification codes (itemClsCd) for use when registering items',
  })
  @ApiResponse({ status: 200, description: 'Matching classification codes' })
  async searchItemClassifications(
    @Query() query: SearchItemClassificationsQueryDto,
  ) {
    const itemClsLvl =
      query.itemClsLvl !== undefined ? Number(query.itemClsLvl) : undefined;
    if (itemClsLvl !== undefined && !Number.isInteger(itemClsLvl)) {
      throw new BadRequestException('itemClsLvl must be an integer');
    }
    const limit = query.limit !== undefined ? Number(query.limit) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new BadRequestException('limit must be a positive integer');
    }

    const results = await this.catalogService.searchItemClassifications({
      query: query.query,
      itemClsLvl,
      includeInactive: query.includeInactive === 'true',
      limit,
    });
    return { results };
  }

  @Get('item-classifications/:itemClsCd')
  @ApiOperation({ summary: 'Fetch a single OSCU item classification code' })
  @ApiResponse({ status: 200, description: 'Classification code' })
  async getItemClassification(@Param('itemClsCd') itemClsCd: string) {
    const found = await this.catalogService.getItemClassification(itemClsCd);
    if (!found) {
      throw new NotFoundException(
        `Unknown item classification code: ${itemClsCd}`,
      );
    }
    return found;
  }

  @Post('item-classifications/sync')
  @ApiOperation({
    summary:
      'Pull the latest item classification reference list from OSCU (/selectItemClsList) and upsert it locally',
  })
  @ApiResponse({ status: 201, description: 'Sync result' })
  async syncItemClassifications(@Body() body: SyncItemClassificationsDto) {
    return this.catalogService.syncItemClassifications({
      merchantId: body.merchantId,
      branchId: body.branchId,
      full: body.full,
    });
  }

  @Get('code-classes')
  @ApiOperation({
    summary:
      "List OSCU code groups (cdCls), e.g. '10' Unit of Quantity, '17' Packaging Unit, '04' Tax Type",
  })
  @ApiResponse({ status: 200, description: 'Code groups' })
  async listCodeClasses(@Query() query: ListCodeClassesQueryDto) {
    const results = await this.catalogService.listCodeClasses(
      query.includeInactive === 'true',
    );
    return { results };
  }

  @Get('codes')
  @ApiOperation({
    summary:
      'Search OSCU codes (qtyUnitCd, pkgUnitCd, taxTyCd, itemTyCd, pmtTyCd...) within a code group',
  })
  @ApiResponse({ status: 200, description: 'Matching codes' })
  async searchCodes(@Query() query: SearchCodesQueryDto) {
    const limit = query.limit !== undefined ? Number(query.limit) : undefined;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new BadRequestException('limit must be a positive integer');
    }

    const results = await this.catalogService.searchCodes({
      cdCls: query.cdCls,
      query: query.query,
      includeInactive: query.includeInactive === 'true',
      limit,
    });
    return { results };
  }

  @Post('codes/sync')
  @ApiOperation({
    summary:
      'Pull the latest code list from OSCU (/selectCodeList) and upsert it locally',
  })
  @ApiResponse({ status: 201, description: 'Sync result' })
  async syncCodeList(@Body() body: SyncCodeListDto) {
    return this.catalogService.syncCodeList({
      merchantId: body.merchantId,
      branchId: body.branchId,
      full: body.full,
    });
  }

  @Post('reference-data/sync-now')
  @ApiOperation({
    summary:
      "On-demand version of the daily 2am reference-data sync — pulls both the OSCU code list and item classifications for every environment that has an ACTIVE eTIMS connection, without needing to know that connection's merchantId/branchId. Pass full:true to ignore each environment's watermark and re-pull everything instead of just what's new.",
  })
  @ApiResponse({ status: 201, description: 'Per-environment sync results' })
  async syncReferenceDataNow(@Body() body: SyncReferenceDataNowDto) {
    const results = await this.catalogService.syncReferenceDataFromOscu(
      body?.full ?? false,
    );
    return { results };
  }
}
