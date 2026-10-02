import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { DashboardPurchasesApplicationService } from '../../../dashboard-purchases/application/dashboard-purchases.application.service';
import type { PurchaseConfirmationStatus } from '../../../dashboard-purchases/infrastructure/persistence/purchase-invoice.orm-entity';
import { V1ScopeService } from '../../application/v1-scope.service';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import { RequiredApiTenantId } from '../../infrastructure/decorators/api-caller.decorator';
import { RequireScopes } from '../../infrastructure/decorators/require-scopes.decorator';
import {
  optionalEnum,
  optionalString,
  readBody,
  readPageSize,
  requiredDate,
} from './v1-input';
import { V1Api } from './v1-api.decorator';
import { toV1Purchase } from './v1-views';

const PURCHASE_STATUSES: readonly PurchaseConfirmationStatus[] = [
  'pulled',
  'pending_review',
  'confirmed',
  'rejected',
];

/**
 * Supplier invoices KRA holds for a business: what its suppliers filed against
 * its PIN. Read-only here. Confirming or rejecting an invoice is a write to KRA
 * and stays a dashboard action until it is deliberately opened up with its own
 * scope.
 */
@Controller('v1/purchases')
@V1Api()
export class V1PurchasesController {
  constructor(
    private readonly purchases: DashboardPurchasesApplicationService,
    private readonly scope: V1ScopeService,
  ) {}

  @Post('pull')
  @HttpCode(200)
  @RequireScopes(ApiKeyScope.PURCHASES_READ)
  @ApiOperation({
    summary:
      'Fetch the business’s supplier invoices from KRA and store them. Returns how each branch went; list them with GET /v1/purchases. Re-pulling never changes an invoice’s review status.',
  })
  async pull(
    @RequiredApiTenantId() tenantId: string,
    @Body() rawBody: unknown,
  ) {
    const body = rawBody === undefined ? {} : readBody(rawBody);
    const requested = optionalString(body, 'branchId');
    // A named branch must belong to this business; omitted means every branch
    // the business has an eTIMS connection for.
    const branch = requested
      ? await this.scope.resolveBranch(tenantId, requested)
      : null;

    const branches = await this.purchases.pullBranches(tenantId, {
      branchId: branch?.id,
    });

    // 200 with a report when KRA answered for at least one branch. Nothing at
    // all from KRA is a 502: an empty success there would read as "you have no
    // purchases", which is the one wrong answer.
    if (branches.length > 0 && branches.every((b) => b.status === 'failed')) {
      throw new BadGatewayException({
        message: 'KRA did not return purchases for any branch. Try again shortly.',
        branches,
      });
    }

    return {
      data: {
        fetched: branches.reduce((n, b) => n + b.fetched, 0),
        branches,
      },
    };
  }

  @Get()
  @RequireScopes(ApiKeyScope.PURCHASES_READ)
  @ApiOperation({
    summary:
      'List the business’s stored supplier invoices, newest first. Call POST /v1/purchases/pull first to fetch the latest from KRA.',
  })
  async list(
    @RequiredApiTenantId() tenantId: string,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const size = readPageSize(pageSize);
    const page = await this.purchases.listPage(tenantId, {
      cursor: cursor || undefined,
      pageSize: size,
      status: optionalEnum({ status }, 'status', PURCHASE_STATUSES),
      startDate: startDate ? requiredDate({ startDate }, 'startDate') : undefined,
      endDate: endDate ? requiredDate({ endDate }, 'endDate') : undefined,
    });
    return {
      data: { purchases: page.data.map(toV1Purchase) },
      pagination: { nextCursor: page.next, pageSize: size },
    };
  }

  @Get(':id')
  @RequireScopes(ApiKeyScope.PURCHASES_READ)
  @ApiOperation({ summary: 'One supplier invoice' })
  async get(@RequiredApiTenantId() tenantId: string, @Param('id') id: string) {
    return { data: { purchase: toV1Purchase(await this.purchases.getById(tenantId, id)) } };
  }
}
