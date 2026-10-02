import { InvoiceType } from '../../../shared/domain/enums/invoice-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import {
  applyInvoiceTypeOverride,
  findItemsNotRegisteredExempt,
} from './invoice-type.util';

describe('applyInvoiceTypeOverride', () => {
  const lines = [
    { taxCategory: TaxCategory.VAT_STANDARD, taxAmount: 1600, itemId: 'a' },
    { taxCategory: TaxCategory.VAT_8, taxAmount: 400, itemId: 'b' },
  ];

  it('leaves lines untouched for a NORMAL invoice', () => {
    expect(applyInvoiceTypeOverride(lines, InvoiceType.NORMAL)).toEqual(lines);
  });

  // The point of the whole function: a caller's own tax math must never
  // reach KRA once the sale is filed as exempt.
  it('forces every line to EXEMPT with zero tax, whatever the caller sent', () => {
    const out = applyInvoiceTypeOverride(lines, InvoiceType.EXEMPT);
    expect(out).toEqual([
      { taxCategory: TaxCategory.EXEMPT, taxAmount: 0, taxTyCdSnapshot: 'A', itemId: 'a' },
      { taxCategory: TaxCategory.EXEMPT, taxAmount: 0, taxTyCdSnapshot: 'A', itemId: 'b' },
    ]);
  });

  // taxCategory alone never reaches KRA or the receipt -- only
  // taxTyCdSnapshot does (etims-payload.builder.ts maps
  // `taxTyCd: line.taxTyCdSnapshot ?? 'D'`), and it otherwise falls back to
  // the catalog item's own code regardless of taxCategory. Confirmed live:
  // an earlier version of this function that only set taxCategory/taxAmount
  // produced a document flagged EXEMPT whose actual KRA submission still
  // charged the item's real VAT rate.
  it('sets taxTyCdSnapshot to KRA’s Exempt code (A), not just taxCategory', () => {
    const out = applyInvoiceTypeOverride(lines, InvoiceType.EXEMPT);
    expect(out.every((l) => l.taxTyCdSnapshot === 'A')).toBe(true);
  });

  it('leaves taxTyCdSnapshot alone for a NORMAL invoice', () => {
    const withSnapshot = [{ taxCategory: TaxCategory.VAT_8, taxAmount: 400, taxTyCdSnapshot: 'E' }];
    expect(applyInvoiceTypeOverride(withSnapshot, InvoiceType.NORMAL)).toEqual(withSnapshot);
  });

  it('does not mutate the input array', () => {
    const before = JSON.stringify(lines);
    applyInvoiceTypeOverride(lines, InvoiceType.EXEMPT);
    expect(JSON.stringify(lines)).toBe(before);
  });

  it('is a no-op on an empty line set', () => {
    expect(applyInvoiceTypeOverride([], InvoiceType.EXEMPT)).toEqual([]);
  });
});

describe('findItemsNotRegisteredExempt', () => {
  const exemptItem = { id: 'item-1', name: 'Facility Interest Charge', taxTyCd: 'A' };
  const vatItem = { id: 'item-2', name: 'Grilled Goat Ribs', taxTyCd: 'B' };

  it('is empty when every item is already registered Exempt', () => {
    expect(findItemsNotRegisteredExempt([exemptItem])).toEqual([]);
  });

  // The evidence this landed on, after two wrong "corrections": two items
  // sharing one classification code but registered under different taxTyCd
  // values behaved oppositely, which only this field -- the item's own
  // registration -- explains.
  it('names an item registered under a real VAT rate', () => {
    expect(findItemsNotRegisteredExempt([exemptItem, vatItem])).toEqual([vatItem]);
  });

  it('names every offending item, not just the first', () => {
    const anotherVatItem = { id: 'item-3', name: 'Dawa Cocktail', taxTyCd: 'B' };
    expect(findItemsNotRegisteredExempt([vatItem, anotherVatItem])).toEqual([
      vatItem,
      anotherVatItem,
    ]);
  });

  it('is empty for an empty line set', () => {
    expect(findItemsNotRegisteredExempt([])).toEqual([]);
  });
});
