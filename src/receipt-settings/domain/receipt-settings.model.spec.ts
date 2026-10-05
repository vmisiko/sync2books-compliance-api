import {
  DEFAULT_FOOTER_MESSAGE,
  DEFAULT_HEADER_MESSAGE,
  LOCKED_SECTION_KEYS,
  RECEIPT_FIELD_LIMITS,
  RECEIPT_SECTIONS,
  ReceiptSettingsValidationError,
  normaliseReceiptText,
  receiptBlockTextFromView,
  resolveReceiptView,
  truncateReceiptText,
  validateReceiptSettingsInput,
  applyTransmittedSnapshot,
} from './receipt-settings.model';

const connection = {
  tradeAddressLine1: 'Jamhuri, Langata District',
  tradeCity: 'Nairobi',
  receiptHeaderMessage: null,
  receiptFooterMessage: null,
};

describe('resolveReceiptView -- defaults reproduce today\'s receipt', () => {
  it('with nothing configured, every text comes from the same sources the receipt used before', () => {
    const v = resolveReceiptView({
      settings: null,
      supplierName: 'Amani Ltd',
      connection,
      customerPhone: '0712345678',
    });
    expect(v.text.tradeName).toBe('Amani Ltd');
    expect(v.text.address).toBe('Jamhuri, Langata District, Nairobi');
    // Legacy default messages, whitespace-normalised and cut to KRA's 20 chars.
    expect(v.text.headerMessage).toBe(truncateReceiptText(DEFAULT_HEADER_MESSAGE, 20));
    expect(v.text.footerMessage).toBe(
      truncateReceiptText(normaliseReceiptText(DEFAULT_FOOTER_MESSAGE), 20),
    );
    expect(v.text.customerMobile).toBe('0712345678');
    // Layout defaults: no logo, no item codes, phone shown -- identical to the old receipt.
    expect(v.show).toEqual({ logo: false, itemCodes: false, customerPhone: true });
  });

  it('uses the connection\'s own header/footer when set (the pre-existing storage), before the generic default', () => {
    const v = resolveReceiptView({
      settings: null,
      supplierName: 'X',
      connection: { ...connection, receiptHeaderMessage: 'Welcome', receiptFooterMessage: 'Asante' },
      customerPhone: null,
    });
    expect(v.text.headerMessage).toBe('Welcome');
    expect(v.text.footerMessage).toBe('Asante');
    expect(v.text.customerMobile).toBeNull();
  });

  it('a settings text overrides the connection/tenant source; a disabled message section prints and transmits nothing', () => {
    const v = resolveReceiptView({
      settings: {
        sections: { footerMessage: { enabled: false } },
        texts: { tradeName: 'Brand', address: 'Moi Ave 1', headerMessage: 'Karibu' },
      },
      supplierName: 'Legal Name Ltd',
      connection,
      customerPhone: null,
    });
    expect(v.text).toMatchObject({ tradeName: 'Brand', address: 'Moi Ave 1', headerMessage: 'Karibu', footerMessage: null });
  });

  it('logo only shows when switched on AND uploaded', () => {
    const on = { sections: { logo: { enabled: true } }, texts: {} };
    const base = { supplierName: 'X', connection, customerPhone: null };
    expect(resolveReceiptView({ ...base, settings: on, hasLogo: false }).show.logo).toBe(false);
    expect(resolveReceiptView({ ...base, settings: on, hasLogo: true }).show.logo).toBe(true);
    expect(resolveReceiptView({ ...base, settings: null, hasLogo: true }).show.logo).toBe(false);
  });
});

describe('truncation', () => {
  it('cuts to KRA\'s limit, backing off to a word boundary, and is the same function for every field', () => {
    expect(truncateReceiptText('Welcome to SYNC TO BOOKS RECONCILER LIMITED', 20)).toBe('Welcome to SYNC TO');
    expect(truncateReceiptText('Short', 20)).toBe('Short');
    expect(truncateReceiptText('A'.repeat(50), 20)).toBe('A'.repeat(20));
    expect(truncateReceiptText(null, 20)).toBeNull();
  });

  it('resolved text never exceeds the OSCU limits, even from an over-long legacy value', () => {
    const long = 'word '.repeat(80);
    const v = resolveReceiptView({
      settings: null,
      supplierName: long,
      connection: { ...connection, tradeAddressLine1: long, receiptHeaderMessage: long, receiptFooterMessage: long },
      customerPhone: '0'.repeat(40),
    });
    expect(v.text.tradeName!.length).toBeLessThanOrEqual(RECEIPT_FIELD_LIMITS.tradeName);
    expect(v.text.address!.length).toBeLessThanOrEqual(RECEIPT_FIELD_LIMITS.address);
    expect(v.text.headerMessage!.length).toBeLessThanOrEqual(RECEIPT_FIELD_LIMITS.headerMessage);
    expect(v.text.footerMessage!.length).toBeLessThanOrEqual(RECEIPT_FIELD_LIMITS.footerMessage);
    expect(v.text.customerMobile!.length).toBeLessThanOrEqual(RECEIPT_FIELD_LIMITS.customerMobile);
  });
});

describe('validateReceiptSettingsInput -- mandatory sections', () => {
  const locked = RECEIPT_SECTIONS.filter((s) => s.locked).map((s) => s.key);

  it('locks the TIS-required sections', () => {
    expect(locked).toEqual(
      expect.arrayContaining(['kraLogo', 'businessName', 'supplierPin', 'taxTable', 'scuInfo', 'qr', 'itemsTable', 'invoiceNumbers', 'buyerBlock']),
    );
    expect(LOCKED_SECTION_KEYS).toEqual(locked);
  });

  it.each(locked)('refuses to disable the locked section "%s"', (key) => {
    expect(() => validateReceiptSettingsInput({ sections: { [key]: { enabled: false } } })).toThrow(
      ReceiptSettingsValidationError,
    );
  });

  it('accepts enabled:true on a locked section but never stores it; allows toggling the optional ones', () => {
    const out = validateReceiptSettingsInput({
      sections: { qr: { enabled: true }, itemCodes: { enabled: true }, footerMessage: { enabled: false } },
    });
    expect(out.sections).toEqual({ itemCodes: { enabled: true }, footerMessage: { enabled: false } });
  });

  it('refuses unknown sections, unknown/oversize texts', () => {
    expect(() => validateReceiptSettingsInput({ sections: { nope: { enabled: true } } })).toThrow(/Unknown/);
    expect(() => validateReceiptSettingsInput({ texts: { custMblNo: 'x' } })).toThrow(/Unknown/);
    expect(() => validateReceiptSettingsInput({ texts: { headerMessage: 'x'.repeat(21) } })).toThrow(/at most 20/);
    expect(() => validateReceiptSettingsInput('nope')).toThrow(ReceiptSettingsValidationError);
  });

  it('normalises text to a single clean line', () => {
    const out = validateReceiptSettingsInput({ texts: { address: '  Jamhuri\n\tRd  ' , footerMessage: '   ' } });
    expect(out.texts).toEqual({ address: 'Jamhuri Rd', footerMessage: null });
  });
});

describe('applyTransmittedSnapshot', () => {
  it('an already-transmitted document prints exactly what was sent, whatever the settings say now', () => {
    const view = resolveReceiptView({
      settings: { sections: {}, texts: { tradeName: 'Changed' } },
      supplierName: 'X',
      connection,
      customerPhone: null,
    });
    const sent = { trdeNm: 'Old Name', adrs: 'Old Addr', topMsg: null, btmMsg: 'Bye', custMblNo: null };
    const out = applyTransmittedSnapshot(view, sent);
    expect(receiptBlockTextFromView(out)).toEqual(sent);
    expect(applyTransmittedSnapshot(view, null)).toBe(view);
  });
});
