import { resolveLineDiscount } from './line-discount';
import { OscuSalesRequestBuilder } from '../../regulatory/oscu/mapping/oscu-sales-request.builder';

describe('resolveLineDiscount', () => {
  it('derives the amount from a rate', () => {
    expect(resolveLineDiscount(10, 1392, 10)).toEqual({ gross: 13920, rate: 10, amount: 1392, net: 12528 });
  });
  it('derives the rate from an amount, and an amount wins over a rate', () => {
    expect(resolveLineDiscount(2, 500, 50, 100)).toEqual({ gross: 1000, rate: 10, amount: 100, net: 900 });
  });
  it('never discounts below zero, and no discount is the identity', () => {
    expect(resolveLineDiscount(1, 100, undefined, 500).net).toBe(0);
    expect(resolveLineDiscount(3, 60)).toEqual({ gross: 180, rate: 0, amount: 0, net: 180 });
  });
});

describe('OscuSalesRequestBuilder discount', () => {
  it('sends dcRt/dcAmt and splits tax out of the discounted total', () => {
    const req = OscuSalesRequestBuilder.build({
      tin: 'P1',
      bhfId: '00',
      cmcKey: 'k',
      payload: {
        documentNumber: 'INV-1',
        documentType: 'SALE',
        invoiceSequence: 1,
        saleDate: '2026-10-08',
        branchId: 'b',
        deviceId: '',
        currency: 'KES',
        exchangeRate: 1,
        subtotalAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        lines: [
          {
            itemCode: 'KE2NTNO0000002',
            description: 'Dawa Cocktail',
            quantity: 10,
            unitPrice: 522,
            discountRate: 10,
            taxAmount: 0,
            classificationCode: '1000000000',
            unitCode: 'NO',
            packagingUnitCode: 'NT',
            taxTyCd: 'B',
            productTypeCode: '2',
          },
        ],
      },
    });
    const i = req.itemList[0];
    expect(i).toMatchObject({ splyAmt: 4698, dcRt: 10, dcAmt: 522, totAmt: 4698, taxblAmt: 4050, taxAmt: 648 });
    expect(req.totAmt).toBe(4698);
  });
});
