import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { CatalogService } from '../../../catalog/api/catalog.service';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import { V1ScopeService } from '../../application/v1-scope.service';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import { RequiredApiTenantId } from '../../infrastructure/decorators/api-caller.decorator';
import { RequireScopes } from '../../infrastructure/decorators/require-scopes.decorator';
import {
  optionalNumber,
  optionalString,
  readBody,
  requiredEnum,
  requiredString,
} from './v1-input';
import { toV1Item } from './v1-views';
import { V1Api } from './v1-api.decorator';

/** KRA itemTyCd: 1 raw material, 2 finished product, 3 service. */
const PRODUCT_TYPE_CODES = ['1', '2', '3'] as const;

@Controller('v1/items')
@V1Api()
export class V1ItemsController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly scope: V1ScopeService,
  ) {}

  @Post()
  @RequireScopes(ApiKeyScope.CATALOG_WRITE)
  @ApiOperation({
    summary:
      'Create an item, or update the one with the same externalId. Does not register it with KRA -- call POST /v1/items/{id}/register.',
  })
  async upsert(
    @RequiredApiTenantId() tenantId: string,
    @Body() rawBody: unknown,
  ) {
    const body = readBody(rawBody);
    const merchantId = await this.scope.merchantIdFor(tenantId);

    const taxCategory = requiredEnum(
      body,
      'taxCategory',
      Object.values(TaxCategory),
    );
    const productTypeCode = requiredEnum(
      body,
      'productTypeCode',
      PRODUCT_TYPE_CODES,
    );

    const result = await this.catalog.registerItem({
      // Always the resolved business. `merchantId` in the body, if a caller
      // sends one, is never read.
      merchantId,
      externalId: requiredString(body, 'externalId', { max: 100 }),
      name: requiredString(body, 'name', { max: 200 }),
      sku: optionalString(body, 'sku', { max: 100 }) ?? null,
      taxCategory,
      productTypeCode,
      classificationCode: optionalString(body, 'classificationCode', { max: 20 }),
      unitCode: optionalString(body, 'unitCode', { max: 2 }),
      packagingUnitCode: optionalString(body, 'packagingUnitCode', { max: 2 }),
      unitPrice: optionalNumber(body, 'unitPrice', { min: 0 }),
      sourceSystem: 'API',
    });

    return { data: { item: toV1Item(result.item) } };
  }

  @Get()
  @RequireScopes(ApiKeyScope.CATALOG_READ)
  @ApiOperation({ summary: "List the business's items" })
  async list(@RequiredApiTenantId() tenantId: string) {
    const merchantId = await this.scope.merchantIdFor(tenantId);
    const listed = (await this.catalog.listItems(merchantId)) as unknown;
    const items = Array.isArray(listed)
      ? listed
      : ((listed as { items?: unknown[] }).items ?? []);
    return {
      data: {
        items: (items as Parameters<typeof toV1Item>[0][])
          .filter((i) => !i.deletedAt)
          .map(toV1Item),
      },
    };
  }

  @Get(':id')
  @RequireScopes(ApiKeyScope.CATALOG_READ)
  @ApiOperation({ summary: 'One item' })
  async get(
    @RequiredApiTenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    const merchantId = await this.scope.merchantIdFor(tenantId);
    return { data: { item: toV1Item(await this.scope.requireItem(merchantId, id)) } };
  }

  @Post(':id/register')
  @HttpCode(200)
  @RequireScopes(ApiKeyScope.CATALOG_WRITE)
  @ApiOperation({
    summary:
      'Register the item with KRA (OSCU saveItem). An item must be registered before it can be sold.',
  })
  async register(
    @RequiredApiTenantId() tenantId: string,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const body = rawBody === undefined ? {} : readBody(rawBody);
    const merchantId = await this.scope.merchantIdFor(tenantId);
    await this.scope.requireItem(merchantId, id);
    const branch = await this.scope.resolveBranch(
      tenantId,
      optionalString(body, 'branchId'),
    );

    const result = await this.catalog.syncItems({
      merchantId,
      branchId: branch.id,
      itemIds: [id],
      // Re-registering an item KRA already has is the caller's explicit choice.
      onlyPending: body.force === true ? false : true,
      force: body.force === true,
    });

    const outcome = result.results.find((r) => r.itemId === id);
    const item = await this.scope.requireItem(merchantId, id);
    const view = toV1Item(item);

    if (outcome && !outcome.success) {
      // KRA answered: a result code came back with its verdict.
      if (outcome.resultCd != null) {
        throw new UnprocessableEntityException({
          code: 'kra_rejected',
          message: outcome.resultMsg || 'KRA rejected the item registration',
          item: view,
        });
      }
      // No result code means KRA never gave a verdict -- the item was held
      // back locally, or the call did not complete. Calling that "KRA
      // rejected it" would send a developer to debug a request KRA never saw.
      if (item.needsProductType || item.needsClassificationMapping) {
        throw new UnprocessableEntityException({
          code: 'item_incomplete',
          message:
            'This item cannot be registered yet. See item.needs for what is missing, add it with POST /v1/items, then register again.',
          item: view,
        });
      }
      throw new UnprocessableEntityException({
        code: 'registration_failed',
        message:
          outcome.error ??
          'The item could not be registered with KRA. Retry, and contact support if it persists.',
        item: view,
      });
    }

    return { data: { item: view } };
  }
}

