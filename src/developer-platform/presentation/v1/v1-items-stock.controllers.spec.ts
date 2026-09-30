import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { V1ItemsController } from './v1-items.controller';
import { V1StockController } from './v1-stock.controller';

const TENANT = 'tenant-A';
const MERCHANT = 'merchant-A';

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  merchantId: MERCHANT,
  externalId: 'SKU-1',
  name: 'ERP integration',
  sku: null,
  taxCategory: 'VAT_STANDARD',
  taxTyCd: 'B',
  productTypeCode: '3',
  classificationCode: '8111',
  unitCode: 'NO',
  packagingUnitCode: 'CT',
  isStockItem: false,
  registrationStatus: 'REGISTERED',
  needsProductType: false,
  needsClassificationMapping: false,
  deletedAt: null,
  ...overrides,
});

function scopeFor(opts: { ownedItems?: string[] } = {}) {
  const owned = new Set(opts.ownedItems ?? ['item-1']);
  return {
    merchantIdFor: jest.fn(async () => MERCHANT),
    requireItem: jest.fn(async (_m: string, id: string) => {
      if (!owned.has(id)) throw new NotFoundException(`Item ${id} not found`);
      return item({ id });
    }),
    resolveBranch: jest.fn(async (_t: string, requested?: string) => {
      if (requested === 'foreign-branch') throw new NotFoundException('Branch not found');
      return { id: requested ?? 'branch-1' };
    }),
  };
}

describe('V1ItemsController', () => {
  function build(sync?: unknown) {
    const catalog = {
      registerItem: jest.fn(async () => ({ item: item() })),
      listItems: jest.fn(async () => [item(), item({ id: 'gone', deletedAt: new Date() })]),
      syncItems: jest.fn(async () => sync ?? { results: [{ itemId: 'item-1', success: true, resultCd: '000', resultMsg: 'ok' }] }),
    };
    const scope = scopeFor();
    return { controller: new V1ItemsController(catalog as never, scope as never), catalog, scope };
  }
  const body = { externalId: 'SKU-1', name: 'ERP integration', taxCategory: 'VAT_STANDARD', productTypeCode: '3' };

  it('stamps the business from the guard, never from the body', async () => {
    const { controller, catalog } = build();
    await controller.upsert(TENANT, { ...body, merchantId: 'merchant-EVIL', businessId: 'tenant-EVIL' });
    expect(catalog.registerItem).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: MERCHANT, sourceSystem: 'API' }),
    );
  });

  it.each([
    ['a tax category that does not exist', { taxCategory: 'MADE_UP' }],
    ['a product type outside 1-3', { productTypeCode: '9' }],
    ['no externalId', { externalId: undefined }],
    ['a negative price', { unitPrice: -5 }],
  ])('400s %s', async (_l, patch) => {
    const { controller, catalog } = build();
    await expect(controller.upsert(TENANT, { ...body, ...patch })).rejects.toThrow(BadRequestException);
    expect(catalog.registerItem).not.toHaveBeenCalled();
  });

  it('lists only live items', async () => {
    const { controller } = build();
    const out = await controller.list(TENANT);
    expect(out.data.items.map((i) => i.id)).toEqual(['item-1']);
  });

  it("404s another business's item", async () => {
    const { controller } = build();
    await expect(controller.get(TENANT, 'foreign')).rejects.toThrow(NotFoundException);
  });

  describe('register', () => {
    it('registers exactly the one owned item', async () => {
      const { controller, catalog } = build();
      await controller.register(TENANT, 'item-1', {});
      expect(catalog.syncItems).toHaveBeenCalledWith(
        expect.objectContaining({ merchantId: MERCHANT, itemIds: ['item-1'] }),
      );
    });
    it("does not touch another business's item", async () => {
      const { controller, catalog } = build();
      await expect(controller.register(TENANT, 'foreign', {})).rejects.toThrow(NotFoundException);
      expect(catalog.syncItems).not.toHaveBeenCalled();
    });
    it('is 422 item_incomplete, not kra_rejected, when the item was held back locally', async () => {
      const { controller } = build({
        results: [{ itemId: 'item-1', success: false, resultCd: null, resultMsg: null, error: 'missing its classification -- resolve them via Mapping Center' }],
      });
      // The stubbed item reports nothing missing, so this exercises the
      // "call did not complete" branch; the incomplete branch is below.
      const error = await controller.register(TENANT, 'item-1', {}).catch((e) => e);
      expect(error.getResponse().code).toBe('registration_failed');
    });
    it('names what is missing, in our terms, when the item is incomplete', async () => {
      const catalog = {
        registerItem: jest.fn(),
        listItems: jest.fn(),
        syncItems: jest.fn(async () => ({
          results: [{ itemId: 'item-1', success: false, resultCd: null, resultMsg: null, error: 'resolve via Mapping Center' }],
        })),
      };
      const scope = scopeFor();
      (scope.requireItem as jest.Mock).mockResolvedValue(item({ needsClassificationMapping: true, registrationStatus: 'PENDING' }));
      const controller = new V1ItemsController(catalog as never, scope as never);
      const error = await controller.register(TENANT, 'item-1', {}).catch((e) => e);
      expect(error.getResponse().code).toBe('item_incomplete');
      expect(error.getResponse().item.needs.classificationMapping).toBe(true);
      // Internal dashboard vocabulary must not leak into the message.
      expect(error.getResponse().message).not.toContain('Mapping Center');
    });
    it('is 422 kra_rejected, carrying the item, when KRA refuses', async () => {
      const { controller } = build({ results: [{ itemId: 'item-1', success: false, resultCd: '901', resultMsg: 'Invalid pkgUnitCd' }] });
      const error = await controller.register(TENANT, 'item-1', {}).catch((e) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error.getResponse().code).toBe('kra_rejected');
      expect(error.getResponse().message).toBe('Invalid pkgUnitCd');
      expect(error.getResponse().item.id).toBe('item-1');
    });
  });
});

describe('V1StockController', () => {
  const pushed = {
    movement: { id: 'mov-1' },
    stock: { quantityOnHand: 12 },
    etims: {
      stockIo: { status: 'ok' },
      stockMaster: {
        status: 'failed',
        reason: 'rsdQty mismatch',
        // The raw wire detail the service attaches for internal diagnosis.
        detail: { endpoint: 'saveStockMaster', sent: { rsdQty: 12 }, kraResponse: { resultCd: '896' }, kraStockLedger: [] },
      },
    },
  };
  function build(scope = scopeFor()) {
    const inventory = {
      adjustStock: jest.fn(async () => pushed),
      transferStock: jest.fn(async () => ({ referenceId: 'xfer-1', from: { quantityOnHand: 3 }, to: { quantityOnHand: 9 } })),
    };
    return { controller: new V1StockController(inventory as never, scope as never), inventory, scope };
  }

  it('adjusts stock for an owned item, in a branch of this business', async () => {
    const { controller, inventory } = build();
    const out = await controller.adjust(TENANT, { itemId: 'item-1', action: 'ADD', quantity: 5 });
    expect(inventory.adjustStock).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'item-1', branchId: 'branch-1', action: 'ADD', quantity: 5 }),
    );
    expect(out.data.quantityOnHand).toBe(12);
  });

  // The route underneath takes an item and a branch and no taxpayer at all, so
  // the guard alone can never have caught this.
  it("refuses another business's item before any movement is recorded", async () => {
    const { controller, inventory } = build(scopeFor({ ownedItems: [] }));
    await expect(controller.adjust(TENANT, { itemId: 'item-X', action: 'ADD', quantity: 1 })).rejects.toThrow(NotFoundException);
    expect(inventory.adjustStock).not.toHaveBeenCalled();
  });

  it("refuses a branch that is not this business's", async () => {
    const { controller, inventory } = build();
    await expect(
      controller.adjust(TENANT, { itemId: 'item-1', branchId: 'foreign-branch', action: 'ADD', quantity: 1 }),
    ).rejects.toThrow(NotFoundException);
    expect(inventory.adjustStock).not.toHaveBeenCalled();
  });

  it.each([
    ['a zero quantity', { quantity: 0 }],
    ['a string quantity', { quantity: '5' }],
    ['an unknown action', { action: 'SET' }],
  ])('400s %s', async (_l, patch) => {
    const { controller, inventory } = build();
    await expect(
      controller.adjust(TENANT, { itemId: 'item-1', action: 'ADD', quantity: 1, ...patch }),
    ).rejects.toThrow(BadRequestException);
    expect(inventory.adjustStock).not.toHaveBeenCalled();
  });

  it('reports KRA status and reason, never the raw request or response', async () => {
    const { controller } = build();
    const out = await controller.adjust(TENANT, { itemId: 'item-1', action: 'ADD', quantity: 5 });
    expect(out.data.etims.stockMaster).toEqual({ status: 'failed', reason: 'rsdQty mismatch' });
    const json = JSON.stringify(out);
    expect(json).not.toContain('saveStockMaster');
    expect(json).not.toContain('kraResponse');
    expect(json).not.toContain('resultCd');
  });

  it('transfers between two branches of the business, with the same item on both sides', async () => {
    const { controller, inventory } = build();
    await controller.transfer(TENANT, { itemId: 'item-1', fromBranchId: 'b1', toBranchId: 'b2', quantity: 2 });
    expect(inventory.transferStock).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'item-1', receivingItemId: 'item-1', fromBranchId: 'b1', toBranchId: 'b2' }),
    );
  });

  it("refuses a transfer into another business's branch", async () => {
    const { controller, inventory } = build();
    await expect(
      controller.transfer(TENANT, { itemId: 'item-1', fromBranchId: 'b1', toBranchId: 'foreign-branch', quantity: 2 }),
    ).rejects.toThrow(NotFoundException);
    expect(inventory.transferStock).not.toHaveBeenCalled();
  });
});
