import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { CatalogService } from '../../../catalog/api/catalog.service';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import { RequireScopes } from '../../infrastructure/decorators/require-scopes.decorator';
import { V1Api } from './v1-api.decorator';

/** Optional positive integer from a query string; refuses rather than clamps. */
function readLimit(raw: string | undefined, fallback = 50, max = 200): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestException(
      `limit must be a whole number between 1 and ${max}`,
    );
  }
  return parsed;
}

/**
 * KRA's reference data: the code lists and item classifications that every
 * item and sale is validated against.
 *
 * Global rather than per-business -- these are KRA's own tables, identical for
 * every taxpayer -- so these routes need a valid key and the `lookups:read`
 * scope, but name no business. They are read from the local copy, so they are
 * fast and never call KRA.
 */
@Controller('v1/lookups')
@V1Api({ bindsBusiness: false })
export class V1LookupsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('classifications')
  @RequireScopes(ApiKeyScope.LOOKUPS_READ)
  @ApiOperation({
    summary:
      'Search KRA item classification codes (itemClsCd), used when registering an item.',
  })
  async classifications(
    @Query('query') query?: string,
    @Query('level') level?: string,
    @Query('limit') limit?: string,
  ) {
    const itemClsLvl = level === undefined || level === '' ? undefined : Number(level);
    if (itemClsLvl !== undefined && !Number.isInteger(itemClsLvl)) {
      throw new BadRequestException('level must be a whole number');
    }
    const rows = await this.catalog.searchItemClassifications({
      query,
      itemClsLvl,
      includeInactive: false,
      limit: readLimit(limit),
    });
    return {
      data: {
        classifications: rows.map((r) => ({
          code: r.itemClsCd,
          name: r.itemClsNm,
          level: r.itemClsLvl,
          taxTypeCode: r.taxTyCd,
        })),
      },
    };
  }

  @Get('classifications/:code')
  @RequireScopes(ApiKeyScope.LOOKUPS_READ)
  @ApiOperation({ summary: 'One item classification' })
  async classification(@Param('code') code: string) {
    const r = await this.catalog.getItemClassification(code);
    if (!r || r.useYn !== 'Y') {
      throw new NotFoundException(`Unknown item classification code: ${code}`);
    }
    return {
      data: {
        classification: {
          code: r.itemClsCd,
          name: r.itemClsNm,
          level: r.itemClsLvl,
          taxTypeCode: r.taxTyCd,
        },
      },
    };
  }

  @Get('code-classes')
  @RequireScopes(ApiKeyScope.LOOKUPS_READ)
  @ApiOperation({
    summary:
      "KRA's code groups, e.g. 10 unit of quantity, 17 packaging unit, 04 tax type. Pass a group to GET /v1/lookups/codes.",
  })
  async codeClasses() {
    const rows = await this.catalog.listCodeClasses(false);
    return {
      data: {
        codeClasses: rows.map((r) => ({
          code: r.cdCls,
          name: r.cdClsNm,
          description: r.cdClsDesc,
        })),
      },
    };
  }

  @Get('codes')
  @RequireScopes(ApiKeyScope.LOOKUPS_READ)
  @ApiOperation({
    summary:
      'Search KRA codes within a group: units, packaging, tax types, payment types and more.',
  })
  async codes(
    @Query('codeClass') codeClass?: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
  ) {
    const rows = await this.catalog.searchCodes({
      cdCls: codeClass,
      query,
      includeInactive: false,
      limit: readLimit(limit),
    });
    return {
      data: {
        codes: rows.map((r) => ({
          codeClass: r.cdCls,
          code: r.cd,
          name: r.cdNm,
          description: r.cdDesc,
        })),
      },
    };
  }
}
