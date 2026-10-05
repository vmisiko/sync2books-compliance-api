import {
  LEGACY_FOOTER_MESSAGE,
  legacyMessageNotices,
  legacyReceiptView,
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

describe('resolveReceiptView -- defaults', () => {
  it('an unconfigured business: full legal name, address from the connection, NO header/footer/trade name', () => {
    const v = resolveReceiptView({ settings: null, supplierName: 'SYNC TO BOOKS RECONCILER LIMITED', connection, customerPhone: '0712345678' });
    expect(v.text.legalName).toBe('SYNC TO BOOKS RECONCILER LIMITED');
    expect(v.text.tradeName).toBeNull();
    expect(v.text.headerMessage).toBeNull();
    expect(v.text.footerMessage).toBeNull();
    expect(v.text.address).toBe('Jamhuri, Langata District, Nairobi');
    expect(v.text.customerMobile).toBe('0712345678');
    expect(receiptBlockTextFromView(v)).toEqual({ trdeNm: null, adrs: 'Jamhuri, Langata District, Nairobi', topMsg: null, btmMsg: null, custMblNo: '0712345678' });
    expect(v.show).toEqual({ logo: false, itemCodes: false, customerPhone: true });
  });

  it('the legal name is never truncated, whatever its length, and is never transmitted', () => {
    const long = 'A Very Long Registered Business Name That Exceeds Twenty Characters Limited';
    const v = resolveReceiptView({ settings: { sections: {}, texts: { tradeName: 'Short Trade' } }, supplierName: long, connection, customerPhone: null });
    expect(v.text.legalName).toBe(long);
    expect(receiptBlockTextFromView(v).trdeNm).toBe('Short Trade');
  });

  it('legacy connection messages <=20 chars are a usable starting value; longer ones are IGNORED (null), never shortened', () => {
    const ok = resolveReceiptView({ settings: null, supplierName: 'X', connection: { ...connection, receiptHeaderMessage: 'Welcome', receiptFooterMessage: 'Asante' }, customerPhone: null });
    expect(ok.text.headerMessage).toBe('Welcome');
    expect(ok.text.footerMessage).toBe('Asante');
    const long = resolveReceiptView({
      settings: null, supplierName: 'X', customerPhone: null,
      connection: { ...connection, receiptHeaderMessage: 'Welcome to SYNC TO BOOKS RECONCILER LIMITED', receiptFooterMessage: 'THANK YOU - WE LOOK FORWARD TO EARNING YOUR BUSINESS' },
    });
    expect(long.text.headerMessage).toBeNull();
    expect(long.text.footerMessage).toBeNull();
  });

  it('surfaces a notice for each legacy message that is too long, and none for ones that fit', () => {
    expect(legacyMessageNotices({ receiptFooterMessage: 'x'.repeat(30) })).toEqual([
      expect.stringContaining('previous footer message is longer than KRA allows (20 characters)'),
    ]);
    expect(legacyMessageNotices({ receiptHeaderMessage: 'Welcome', receiptFooterMessage: null })).toEqual([]);
  });

  it('settings texts apply as given; a disabled message/trade-name section prints and transmits nothing', () => {
    const v = resolveReceiptView({
      settings: { sections: { footerMessage: { enabled: false }, tradeName: { enabled: false } }, texts: { tradeName: 'Brand', address: 'Moi Ave 1', headerMessage: 'Karibu', footerMessage: 'Bye' } },
      supplierName: 'Legal Name Ltd', connection, customerPhone: null,
    });
    expect(v.text).toMatchObject({ tradeName: null, address: 'Moi Ave 1', headerMessage: 'Karibu', footerMessage: null });
  });

  it('a stored message over the limit is ignored rather than cut', () => {
    const v = resolveReceiptView({ settings: { sections: {}, texts: { headerMessage: 'x'.repeat(25) } }, supplierName: 'X', connection, customerPhone: null });
    expect(v.text.headerMessage).toBeNull();
  });

  it('logo only shows when switched on AND uploaded', () => {
    const on = { sections: { logo: { enabled: true } }, texts: {} };
    const base = { supplierName: 'X', connection, customerPhone: null };
    expect(resolveReceiptView({ ...base, settings: on, hasLogo: false }).show.logo).toBe(false);
    expect(resolveReceiptView({ ...base, settings: on, hasLogo: true }).show.logo).toBe(true);
    expect(resolveReceiptView({ ...base, settings: null, hasLogo: true }).show.logo).toBe(false);
  });
});

describe('legacyReceiptView -- documents transmitted before settings existed', () => {
  it('renders as before: full name, old messages untruncated, no trade name', () => {
    const input = { settings: null, supplierName: 'SYNC TO BOOKS RECONCILER LIMITED', connection: { ...connection, receiptHeaderMessage: 'Welcome to SYNC TO BOOKS RECONCILER LIMITED', receiptFooterMessage: null }, customerPhone: '0712' };
    const v = legacyReceiptView(resolveReceiptView(input), input);
    expect(v.text.legalName).toBe('SYNC TO BOOKS RECONCILER LIMITED');
    expect(v.text.headerMessage).toBe('Welcome to SYNC TO BOOKS RECONCILER LIMITED');
    expect(v.text.footerMessage).toBe(LEGACY_FOOTER_MESSAGE);
    expect(v.text.tradeName).toBeNull();
    expect(v.text.address).toBe('Jamhuri, Langata District, Nairobi');
  });
});

describe('truncateReceiptText (address / phone only)', () => {
  it('cuts to the limit, backing off to a word boundary', () => {
    expect(truncateReceiptText('Welcome to SYNC TO BOOKS RECONCILER LIMITED', 20)).toBe('Welcome to SYNC TO');
    expect(truncateReceiptText('Short', 20)).toBe('Short');
    expect(truncateReceiptText(null, 20)).toBeNull();
  });
  it('resolved address/phone never exceed their limits', () => {
    const long = 'word '.repeat(80);
    const v = resolveReceiptView({ settings: null, supplierName: 'x', connection: { ...connection, tradeAddressLine1: long }, customerPhone: '0'.repeat(40) });
    expect(v.text.address!.length).toBeLessThanOrEqual(RECEIPT_FIELD_LIMITS.address);
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
    for (const k of ['tradeName', 'headerMessage', 'footerMessage']) {
      expect(() => validateReceiptSettingsInput({ texts: { [k]: 'x'.repeat(21) } })).toThrow(new RegExp(`"${k}" is 21 characters; KRA allows at most 20`));
    }
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
