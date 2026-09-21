import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { InventoryService } from '../../../inventory/api/inventory.service';
import type { EtimsPushOutcome } from '../../../inventory/api/inventory.service';
import { V1ScopeService } from '../../application/v1-scope.service';
import { ApiKeyScope } from '../../domain/api-key-scope.enum';
import { RequiredApiTenantId } from '../../infrastructure/decorators/api-caller.decorator';
import { RequireScopes } from '../../infrastructure/decorators/require-scopes.decorator';
import { V1Api } from './v1-api.decorator';
import {
  optionalNumber,
  optionalString,
  readBody,
  requiredEnum,
  requiredNumber,
  requiredString,
} from './v1-input';

/**
 * Only `status` and `reason`. The service's own outcome also carries the raw
 * OSCU request and KRA's reply verbatim, which is the right thing to read when
 * diagnosing from inside and the wrong thing to hand an integrator: it names
 * internal endpoints and the values sent on the wire.
 */
function pushView(outcome: EtimsPushOutcome) {
  return {
    status: outcome.status,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  };
}

@Controller('v1/stock')
@V1Api()
export class V1StockController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly scope: V1ScopeService,
  ) {}

  @Post('adjustments')
  @RequireScopes(ApiKeyScope.STOCK_WRITE)
  @ApiOperation({
    summary:
      'Add or deduct stock for an item at a branch, and report it to KRA (insertStockIO then saveStockMaster).',
  })
  async adjust(
    @RequiredApiTenantId() tenantId: string,
    @Body() rawBody: unknown,
  ) {
    const body = readBody(rawBody);
    const merchantId = await this.scope.merchantIdFor(tenantId);

    const itemId = requiredString(body, 'itemId');
    const item = await this.scope.requireItem(merchantId, itemId);
    const branch = await this.scope.resolveBranch(
      tenantId,
      optionalString(body, 'branchId'),
    );

    const result = await this.inventory.adjustStock({
      itemId: item.id,
      branchId: branch.id,
      action: requiredEnum(body, 'action', ['ADD', 'DEDUCT'] as const),
      quantity: requiredNumber(body, 'quantity', { exclusiveMin: 0 }),
      unitPrice: optionalNumber(body, 'unitPrice', { min: 0 }),
      referenceId: optionalString(body, 'referenceId', { max: 100 }),
    });

    return {
      data: {
        itemId: item.id,
        branchId: branch.id,
        movementId: result.movement.id,
        quantityOnHand: result.stock.quantityOnHand,
        etims: {
          stockIo: pushView(result.etims.stockIo),
          stockMaster: pushView(result.etims.stockMaster),
        },
      },
    };
  }

  @Post('transfers')
  @RequireScopes(ApiKeyScope.STOCK_WRITE)
  @ApiOperation({
    summary: 'Move stock of one item between two of the business’s branches.',
  })
  async transfer(
    @RequiredApiTenantId() tenantId: string,
    @Body() rawBody: unknown,
  ) {
    const body = readBody(rawBody);
    const merchantId = await this.scope.merchantIdFor(tenantId);

    const itemId = requiredString(body, 'itemId');
    const item = await this.scope.requireItem(merchantId, itemId);
    const from = await this.scope.resolveBranch(
      tenantId,
      requiredString(body, 'fromBranchId'),
    );
    const to = await this.scope.resolveBranch(
      tenantId,
      requiredString(body, 'toBranchId'),
    );

    const result = await this.inventory.transferStock({
      itemId: item.id,
      // A transfer moves one item between two branches of one business, so the
      // receiving side is the same item. The service still accepts two items
      // (an item can differ per branch); the public API does not expose that.
      receivingItemId: item.id,
      fromBranchId: from.id,
      toBranchId: to.id,
      quantity: requiredNumber(body, 'quantity', { exclusiveMin: 0 }),
      unitPrice: optionalNumber(body, 'unitPrice', { min: 0 }),
      referenceId: optionalString(body, 'referenceId', { max: 100 }),
    });

    return {
      data: {
        itemId: item.id,
        fromBranchId: from.id,
        toBranchId: to.id,
        referenceId: result.referenceId,
        from: { quantityOnHand: result.from.quantityOnHand },
        to: { quantityOnHand: result.to.quantityOnHand },
      },
    };
  }
}
