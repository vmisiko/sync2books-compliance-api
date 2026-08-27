import { mapMainApiItemToRegisterItemInput, MainApiPulledItem } from './standardized-item.mapper';
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
   * CatalogItem.productTypeCode / deriveItemType), and this mapper only
   * sets it when the ERP source is unambiguous (Service -> KRA itemTyCd
   * '3'; everything else is left unset rather than guessed, per
   * deriveProductTypeCode's doc comment).
   */
  describe('productTypeCode derivation from itemType', () => {
    it('Service sets productTypeCode to KRA itemTyCd 3', () => {
      const result = mapMainApiItemToRegisterItemInput({
        merchantId: 'm1',
        item: pulledItem({ itemType: 'Service' }),
        taxCategory: TaxCategory.OTHER,
      });
      expect(result.productTypeCode).toBe('3');
    });

    it("Inventory leaves productTypeCode unset -- Raw Material vs Finished Product isn't knowable from this ERP signal", () => {
      const result = mapMainApiItemToRegisterItemInput({
        merchantId: 'm1',
        item: pulledItem({ itemType: 'Inventory' }),
        taxCategory: TaxCategory.OTHER,
      });
      expect(result.productTypeCode).toBeUndefined();
    });

    it('NonInventory behaves the same as Inventory on this axis -- productTypeCode unset', () => {
      const result = mapMainApiItemToRegisterItemInput({
        merchantId: 'm1',
        item: pulledItem({ itemType: 'NonInventory' }),
        taxCategory: TaxCategory.OTHER,
      });
      expect(result.productTypeCode).toBeUndefined();
    });

    it('Unknown leaves productTypeCode unset too', () => {
      const result = mapMainApiItemToRegisterItemInput({
        merchantId: 'm1',
        item: pulledItem({ itemType: 'Unknown' }),
        taxCategory: TaxCategory.OTHER,
      });
      expect(result.productTypeCode).toBeUndefined();
    });
  });
});
