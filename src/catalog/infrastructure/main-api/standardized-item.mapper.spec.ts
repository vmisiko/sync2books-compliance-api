import { mapMainApiItemToRegisterItemInput, MainApiPulledItem } from './standardized-item.mapper';
import { ItemType } from '../../../shared/domain/enums/item-type.enum';
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

  it('collapses Service to SERVICE and everything else to GOODS', () => {
    const service = mapMainApiItemToRegisterItemInput({
      merchantId: 'm1',
      item: pulledItem({ itemType: 'Service' }),
      taxCategory: TaxCategory.OTHER,
    });
    expect(service.itemType).toBe(ItemType.SERVICE);

    const inventory = mapMainApiItemToRegisterItemInput({
      merchantId: 'm1',
      item: pulledItem({ itemType: 'Inventory' }),
      taxCategory: TaxCategory.OTHER,
    });
    expect(inventory.itemType).toBe(ItemType.GOODS);
  });
});
