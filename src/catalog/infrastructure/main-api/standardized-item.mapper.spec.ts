import {
  mapMainApiItemToRegisterItemInput,
  normalizeRawItemType,
  MainApiPulledItem,
} from './standardized-item.mapper';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

function pulledItem(overrides: Partial<MainApiPulledItem> = {}): MainApiPulledItem {
  return {
    id: 'i1',
    itemCode: 'IC-1',
    name: 'Widget',
    active: true,
    itemType: 'NonInventory',
    bookId: '1',
    ...overrides,
  };
}

describe('mapMainApiItemToRegisterItemInput', () => {
  it('coerces a decimal-as-string unitPrice (main API\'s MySQL decimal columns serialize as strings) to a real number', () => {
    const input = mapMainApiItemToRegisterItemInput({
      merchantId: 'm1',
      item: pulledItem({ unitPrice: '20.00' as unknown as number }),
      taxCategory: TaxCategory.OTHER,
    });

    expect(input.unitPrice).toBe(20);
    expect(typeof input.unitPrice).toBe('number');
  });

  it('leaves a null/undefined unitPrice as null rather than coercing to 0', () => {
    const withNull = mapMainApiItemToRegisterItemInput({
      merchantId: 'm1',
      item: pulledItem({ unitPrice: null }),
      taxCategory: TaxCategory.OTHER,
    });
    expect(withNull.unitPrice).toBeNull();

    const withUndefined = mapMainApiItemToRegisterItemInput({
      merchantId: 'm1',
      item: pulledItem({ unitPrice: undefined }),
      taxCategory: TaxCategory.OTHER,
    });
    expect(withUndefined.unitPrice).toBeNull();
  });

  /**
   * productTypeCode is the single source of truth (see
   * CatalogItem.productTypeCode / deriveItemType). This mapper *asserts* it
   * only where the ERP signal is unambiguous (Service -> KRA itemTyCd '3');
   * for goods it supplies '2' (Finished Product) as a default instead, which
   * registerItem applies only when nothing stronger -- including a product
   * type a human already set -- has filled the field in.
   */
  describe('productTypeCode derivation from itemType', () => {
    it('Service asserts productTypeCode 3 and needs no default', () => {
      const result = mapMainApiItemToRegisterItemInput({
        merchantId: 'm1',
        item: pulledItem({ itemType: 'Service' }),
        taxCategory: TaxCategory.OTHER,
      });
      expect(result.productTypeCode).toBe('3');
    });

    it.each(['Inventory', 'NonInventory', 'Unknown'] as const)(
      "%s asserts nothing -- Raw Material vs Finished Product isn't knowable from this ERP signal -- and defaults to Finished Product instead",
      (itemType) => {
        const result = mapMainApiItemToRegisterItemInput({
          merchantId: 'm1',
          item: pulledItem({ itemType }),
          taxCategory: TaxCategory.OTHER,
        });
        expect(result.productTypeCode).toBeUndefined();
        expect(result.defaultProductTypeCode).toBe('2');
      },
    );
  });

  /**
   * Records what the ERP does with quantities, and nothing more. It is
   * explicitly NOT the input to isStockItem -- see CatalogItem.isStockItem
   * -- because a QuickBooks NonInventory item is routinely a real good KRA
   * still needs a stock master for. Its use is explaining an item whose
   * stock never reconciles: false means no qtyOnHand will ever arrive.
   */
  describe('stockTracked derivation', () => {
    it.each([
      ['Inventory', true],
      ['NonInventory', false],
      ['Service', false],
    ] as const)('%s -> stockTracked %s', (itemType, expected) => {
      const result = mapMainApiItemToRegisterItemInput({
        merchantId: 'm1',
        item: pulledItem({ itemType }),
        taxCategory: TaxCategory.OTHER,
      });
      expect(result.stockTracked).toBe(expected);
    });

    // qtyOnHand comes back only for stock-tracked items, so its presence
    // answers the question when the type doesn't.
    it('falls back to the presence of qtyOnHand when the type is Unknown', () => {
      expect(
        mapMainApiItemToRegisterItemInput({
          merchantId: 'm1',
          item: pulledItem({ itemType: 'Unknown', qtyOnHand: 12 }),
          taxCategory: TaxCategory.OTHER,
        }).stockTracked,
      ).toBe(true);
    });

    /**
     * Undefined, not false. A normalization gap upstream must not be read as
     * "this item is not stocked" -- registerItem treats undefined as "no one
     * told me" and keeps whatever the row already had, which is the
     * difference between leaving an item alone and silently un-stocking it.
     */
    it('asserts nothing when the type is Unknown and there is no qtyOnHand', () => {
      expect(
        mapMainApiItemToRegisterItemInput({
          merchantId: 'm1',
          item: pulledItem({ itemType: 'Unknown' }),
          taxCategory: TaxCategory.OTHER,
        }).stockTracked,
      ).toBeUndefined();
    });
  });
});

/**
 * The fallback for rows main API returned `standardized: null` for -- its
 * Item.toStandardized() covers QuickBooks and Odoo only, so anything else
 * (and any row with no bookType yet) reaches this repo with just the raw
 * column. See DashboardItemsApplicationService.pullItems, the sole caller.
 */
describe('normalizeRawItemType', () => {
  it.each([
    ['Service', 'Service'],
    ['service', 'Service'],
    ['Inventory', 'Inventory'],
    ['NonInventory', 'NonInventory'],
    ['consu', 'NonInventory'],
  ])('maps raw %s to %s', (raw, expected) => {
    expect(normalizeRawItemType(raw)).toBe(expected);
  });

  it.each([null, undefined, '', 'combo', 'something-else'])(
    'maps %s to Unknown rather than guessing',
    (raw) => {
      expect(normalizeRawItemType(raw)).toBe('Unknown');
    },
  );
});
