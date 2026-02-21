import { OscuSalesRequestBuilder } from './oscu-sales-request.builder';

describe('OscuSalesRequestBuilder', () => {
  it('builds /saveTrnsSalesOsdc request with tax bucketing', () => {
    const req = OscuSalesRequestBuilder.build({
      tin: 'A123456789Z',
      bhfId: '00',
      cmcKey: 'cmc',
      now: new Date('2026-02-20T10:20:30Z'),
      payload: {
        documentNumber: 'INV-123',
        documentType: 'SALE_INVOICE',
        branchId: '00',
        deviceId: 'dev',
        currency: 'KES',
        exchangeRate: 1,
        subtotalAmount: 100,
        taxAmount: 16,
        totalAmount: 116,
        lines: [
          {
            itemCode: 'ITEM-1',
            description: 'Line 1',
            quantity: 1,
            unitPrice: 100,
            taxAmount: 16,
            classificationCode: '14111400',
            unitCode: 'U',
            packagingUnitCode: 'NT',
            taxTyCd: 'B',
            productTypeCode: '2',
          },
        ],
      },
    });

    expect(req.tin).toBe('A123456789Z');
    expect(req.bhfId).toBe('00');
    expect(req.trdInvcNo).toBe('INV-123');
    expect(req.rcptTyCd).toBe('S');
    expect(req.totItemCnt).toBe(1);
    expect(req.taxblAmtB).toBe(100);
    expect(req.taxAmtB).toBe(16);
    expect(req.totTaxblAmt).toBe(100);
    expect(req.totTaxAmt).toBe(16);
    expect(req.itemList[0].itemClsCd).toBe('14111400');
    expect(req.itemList[0].qtyUnitCd).toBe('U');
    expect(req.itemList[0].pkgUnitCd).toBe('NT');
  });

  it('uses R receipt type for credit note', () => {
    const req = OscuSalesRequestBuilder.build({
      tin: 'A123456789Z',
      bhfId: '00',
      cmcKey: 'cmc',
      now: new Date('2026-02-20T10:20:30Z'),
      payload: {
        documentNumber: 'CN-1',
        documentType: 'CREDIT_NOTE',
        originalDocumentNumber: 'INV-123',
        branchId: '00',
        deviceId: 'dev',
        currency: 'KES',
        exchangeRate: 1,
        subtotalAmount: 10,
        taxAmount: 0,
        totalAmount: 10,
        lines: [
          {
            itemCode: 'ITEM-1',
            description: 'Line 1',
            quantity: 1,
            unitPrice: 10,
            taxAmount: 0,
            classificationCode: '14111400',
            unitCode: 'U',
            packagingUnitCode: 'NT',
            taxTyCd: 'A',
            productTypeCode: '2',
          },
        ],
      },
    });

    expect(req.rcptTyCd).toBe('R');
    expect(req.orgInvcNo).toBe(123);
  });
});
