import { InvoiceType } from '../../../shared/domain/enums/invoice-type.enum';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import {
  applyInvoiceTypeOverride,
  findItemsIneligibleForExempt,
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

describe('findItemsIneligibleForExempt', () => {
  const exemptItem = { id: 'item-1', name: 'Facility Interest Charge', classificationCode: '1000000000' };
  const vatItem = { id: 'item-2', name: 'Grilled Goat Ribs', classificationCode: '1010150800' };
  const unsyncedItem = { id: 'item-3', name: 'New Item', classificationCode: '9999999999' };
  const unregisteredItem = { id: 'item-4', name: 'Draft Item', classificationCode: '' };

  const classifications = new Map([
    ['1000000000', { itemClsCd: '1000000000', taxTyCd: 'A' }],
    ['1010150800', { itemClsCd: '1010150800', taxTyCd: 'B' }],
  ]);

  it('is empty when the item’s classification is itself Exempt', () => {
    expect(findItemsIneligibleForExempt([exemptItem], classifications)).toEqual([]);
  });

  // Live-corrected 2026-09-28: KRA validates against the classification's own
  // tax type, not the item's locally-stored default -- an item classified
  // "Goats" (KRA taxTyCd B) is rejected regardless of what a merchant set
  // locally.
  it('names an item whose classification is taxed, not Exempt', () => {
    expect(findItemsIneligibleForExempt([exemptItem, vatItem], classifications)).toEqual([vatItem]);
  });

  it('names every offending item, not just the first', () => {
    const anotherVatItem = { id: 'item-5', name: 'Dawa Cocktail', classificationCode: '1010150800' };
    expect(findItemsIneligibleForExempt([vatItem, anotherVatItem], classifications)).toEqual([
      vatItem,
      anotherVatItem,
    ]);
  });

  // No positive KRA evidence either way -- refusing would block a possibly
  // legitimate sale for nothing; KRA's own response is still authoritative.
  it('lets through an item whose classification never synced locally', () => {
    expect(findItemsIneligibleForExempt([unsyncedItem], classifications)).toEqual([]);
  });

  it('lets through an item with no classification code at all', () => {
    expect(findItemsIneligibleForExempt([unregisteredItem], classifications)).toEqual([]);
  });

  it('is empty for an empty line set', () => {
    expect(findItemsIneligibleForExempt([], classifications)).toEqual([]);
  });
});
