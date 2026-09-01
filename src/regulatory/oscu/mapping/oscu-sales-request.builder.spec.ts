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
        invoiceSequence: 1,
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
    // invcNo comes from the real allocated sequence, not parsed from documentNumber.
    expect(req.invcNo).toBe(1);
    expect(req.rcptTyCd).toBe('S');
    expect(req.totItemCnt).toBe(1);
    // KRA treats splyAmt (qty * unitPrice = 100) as the tax-inclusive line total and
    // derives taxblAmt/taxAmt from it -- confirmed live against the sandbox 2026-08-11.
    expect(req.taxblAmtB).toBe(86.21);
    expect(req.taxAmtB).toBe(13.79);
    expect(req.totTaxblAmt).toBe(86.21);
    expect(req.totTaxAmt).toBe(13.79);
    expect(req.totAmt).toBe(100);
    expect(req.itemList[0].totAmt).toBe(100);
    expect(req.itemList[0].pkg).toBe(1);
    expect(req.itemList[0].itemClsCd).toBe('14111400');
    expect(req.itemList[0].qtyUnitCd).toBe('U');
    expect(req.itemList[0].pkgUnitCd).toBe('NT');
    expect(req.salesTyCd).toBe('N');
    expect(req.prchrAcptcYn).toBe('N');
  });

  it('sends pkg: 1 for pkgUnitCd "NT" regardless of quantity', () => {
    // KRA's pkg field is a package COUNT, independent of qty -- confirmed live
    // 2026-09-01: a qty: 2 line with pkgUnitCd "NT" sending pkg: 2 was rejected
    // with "Invalid pkg for ItemList 1. Expected: 1, Found: 2".
    const req = OscuSalesRequestBuilder.build({
      tin: 'A123456789Z',
      bhfId: '00',
      cmcKey: 'cmc',
      now: new Date('2026-02-20T10:20:30Z'),
      payload: {
        documentNumber: 'INV-124',
        documentType: 'SALE_INVOICE',
        invoiceSequence: 1,
        branchId: '00',
        deviceId: 'dev',
        currency: 'KES',
        exchangeRate: 1,
        subtotalAmount: 200,
        taxAmount: 32,
        totalAmount: 232,
        lines: [
          {
            itemCode: 'ITEM-1',
            description: 'Line 1',
            quantity: 2,
            unitPrice: 100,
            taxAmount: 32,
            classificationCode: '14111400',
            unitCode: 'U',
            packagingUnitCode: 'NT',
            taxTyCd: 'B',
            productTypeCode: '2',
          },
        ],
      },
    });

    expect(req.itemList[0].qty).toBe(2);
    expect(req.itemList[0].pkg).toBe(1);
  });

  it('sends pkg: 1 for a non-"NT" pkgUnitCd too, regardless of quantity', () => {
    // Confirmed live 2026-09-01: pkgUnitCd "CT" (Carton), qty: 56, pkg: 56 was
    // rejected the same way ("Invalid pkg for ItemList 1. Expected: 1, Found: 56"),
    // disproving the earlier "only NT needs pkg: 1" theory -- KRA expects pkg: 1
    // unconditionally for sendSalesTransaction.
    const req = OscuSalesRequestBuilder.build({
      tin: 'A123456789Z',
      bhfId: '00',
      cmcKey: 'cmc',
      now: new Date('2026-02-20T10:20:30Z'),
      payload: {
        documentNumber: 'INV-125',
        documentType: 'SALE_INVOICE',
        invoiceSequence: 1,
        branchId: '00',
        deviceId: 'dev',
        currency: 'KES',
        exchangeRate: 1,
        subtotalAmount: 56000,
        taxAmount: 0,
        totalAmount: 56000,
        lines: [
          {
            itemCode: 'ITEM-1',
            description: 'Attachment Flow Test Service',
            quantity: 56,
            unitPrice: 1000,
            taxAmount: 0,
            classificationCode: '1000000000',
            unitCode: 'NO',
            packagingUnitCode: 'CT',
            taxTyCd: 'D',
            productTypeCode: '3',
          },
        ],
      },
    });

    expect(req.itemList[0].qty).toBe(56);
    expect(req.itemList[0].pkgUnitCd).toBe('CT');
    expect(req.itemList[0].pkg).toBe(1);
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
        invoiceSequence: 2,
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
