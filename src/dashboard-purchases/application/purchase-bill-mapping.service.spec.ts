import { BadRequestException } from '@nestjs/common';
import { PurchaseBillMappingService, zeroRateTaxConflict } from './purchase-bill-mapping.service';
import type { PurchaseBillMappingOrmEntity } from '../infrastructure/persistence/purchase-bill-mapping.orm-entity';

const TENANT_ID = 'tenant-1';
const MERCHANT_ID = 'merchant-1';

const OPTIONS = {
  integrationKey: 'quickbooks',
  accounts: [
    { id: '80', name: 'Cost of Goods Sold', accountType: 'Cost of Goods Sold', isExpense: true },
    { id: '1', name: 'Services', accountType: 'Income', isExpense: false },
  ],
  taxes: [
    { id: '2', name: '16.0% S', usableForPurchases: true },
    { id: '12', name: 'Exempt Sale', usableForPurchases: false },
    { id: '13', name: 'Exempt Purchase', usableForPurchases: true },
    { id: '6', name: '0.0% Z', usableForPurchases: true },
    { id: '9', name: 'No VAT', usableForPurchases: true },
  ],
  warnings: [],
};

function makeService(opts: { rows?: Partial<PurchaseBillMappingOrmEntity>[]; connected?: boolean } = {}) {
  const rows = [...(opts.rows ?? [])] as PurchaseBillMappingOrmEntity[];
  const repo = {
    find: jest.fn().mockImplementation(async ({ where }) =>
      rows.filter((r) => r.merchantId === where.merchantId && r.integrationKey === where.integrationKey),
    ),
    findOne: jest.fn().mockImplementation(async ({ where }) =>
      rows.find((r) =>
        Object.entries(where).every(([k, v]) => (r as any)[k] === v),
      ) ?? null,
    ),
    create: jest.fn().mockImplementation((v) => ({ ...v })),
    save: jest.fn().mockImplementation(async (v) => {
      if (!rows.includes(v)) rows.push(v);
      return v;
    }),
    delete: jest.fn().mockImplementation(async (where) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (Object.entries(where).every(([k, v]) => (rows[i] as any)[k] === v)) rows.splice(i, 1);
      }
    }),
  };
  const mainApiConnections = {
    resolveMerchantId: jest.fn().mockResolvedValue(MERCHANT_ID),
    getForTenant: jest.fn().mockResolvedValue({
      mainApiApiKey: 'key-1',
      integrations:
        opts.connected === false
          ? {}
          : { quickbooks: { connectionId: 'conn-1' } },
    }),
  };
  const mainApiPull = { getBillMappingOptions: jest.fn().mockResolvedValue(OPTIONS) };
  const service = new PurchaseBillMappingService(repo as any, mainApiConnections as any, mainApiPull as any);
  return { service, rows, mainApiPull };
}

describe('PurchaseBillMappingService', () => {
  it('suggests purchase-usable taxes by name for unmapped KRA types only', async () => {
    const { service } = makeService({
      rows: [{ merchantId: MERCHANT_ID, integrationKey: 'quickbooks', kind: 'tax', taxTyCd: 'A', erpId: '13', erpName: 'Exempt Purchase' }],
    });

    const view = await service.get(TENANT_ID);

    expect(view.connected).toBe(true);
    expect(view.mapping.taxes.A).toEqual({ erpId: '13', erpName: 'Exempt Purchase' });
    expect(view.suggestedTaxes).toEqual({ B: '2', C: '6', D: '9' });
  });

  it('saves the account and taxes with names taken from the ERP, and reads them back for sync', async () => {
    const { service } = makeService();

    await service.save(TENANT_ID, { expenseAccountId: '80', taxes: { B: '2', C: '6' } }, 'me@x.com');
    const resolved = await service.resolveForSync(TENANT_ID, MERCHANT_ID);

    expect(resolved).toEqual(
      expect.objectContaining({
        integrationKey: 'quickbooks',
        connectionId: 'conn-1',
        expenseAccount: { erpId: '80', erpName: 'Cost of Goods Sold' },
        taxes: { B: { erpId: '2', erpName: '16.0% S' }, C: { erpId: '6', erpName: '0.0% Z' } },
      }),
    );
  });

  it('clears a mapped tax with null and leaves omitted ones alone', async () => {
    const { service } = makeService();
    await service.save(TENANT_ID, { taxes: { B: '2', C: '6' } }, null);

    await service.save(TENANT_ID, { taxes: { C: null } }, null);
    const resolved = await service.resolveForSync(TENANT_ID, MERCHANT_ID);

    expect(Object.keys(resolved!.taxes)).toEqual(['B']);
  });

  it('rejects an id the ERP does not have, and a sales-only tax', async () => {
    const { service } = makeService();

    await expect(service.save(TENANT_ID, { expenseAccountId: '999' }, null)).rejects.toThrow(BadRequestException);
    await expect(service.save(TENANT_ID, { taxes: { A: '12' } }, null)).rejects.toThrow(/sales-only/);
    await expect(service.save(TENANT_ID, { taxes: { Z: '2' } }, null)).rejects.toThrow(/Unknown KRA tax type/);
  });

  it('keys the mapping by ERP so another connected ERP starts empty', async () => {
    const { service } = makeService({
      rows: [{ merchantId: MERCHANT_ID, integrationKey: 'odoo', kind: 'expense_account', taxTyCd: '', erpId: '5', erpName: 'Odoo expense' }],
    });

    const resolved = await service.resolveForSync(TENANT_ID, MERCHANT_ID);

    expect(resolved!.expenseAccount).toBeNull();
  });

  it('returns a disconnected view and null for sync when no ERP is connected', async () => {
    const { service, mainApiPull } = makeService({ connected: false });

    expect((await service.get(TENANT_ID)).connected).toBe(false);
    expect(await service.resolveForSync(TENANT_ID, MERCHANT_ID)).toBeNull();
    expect(mainApiPull.getBillMappingOptions).not.toHaveBeenCalled();
  });
  describe('resolveAccountOverride', () => {
    const connection = { connectionId: 'conn-1', mainApiApiKey: 'key-1' };

    it('returns the ERP\'s own name for an account it has, not anything from the caller', async () => {
      const { service, mainApiPull } = makeService();

      await expect(service.resolveAccountOverride(connection, '80')).resolves.toEqual({
        erpId: '80',
        erpName: 'Cost of Goods Sold',
      });
      expect(mainApiPull.getBillMappingOptions).toHaveBeenCalledWith('key-1', 'conn-1');
    });

    it('accepts any account the ERP lists, expense or not, since the user chose it on purpose', async () => {
      const { service } = makeService();
      await expect(service.resolveAccountOverride(connection, '1')).resolves.toMatchObject({ erpName: 'Services' });
    });

    it('refuses an id the ERP does not have', async () => {
      const { service } = makeService();
      await expect(service.resolveAccountOverride(connection, '999')).rejects.toThrow(BadRequestException);
      await expect(service.resolveAccountOverride(connection, '999')).rejects.toThrow(/was not found/);
    });

    it('does not change the saved default', async () => {
      const { service, rows } = makeService();
      await service.resolveAccountOverride(connection, '80');
      expect(rows).toHaveLength(0);
    });
  });
});

describe('zero-rate tax guard', () => {
  const WH = { id: '7', name: '2% WH', usableForPurchases: true, rate: -2, rateType: 'percent' };
  const ZERO = { id: '8', name: '0% Zero', usableForPurchases: true, rate: 0, rateType: 'percent' };
  const SIXTEEN = { id: '9', name: '16% VAT', usableForPurchases: true, rate: 16, rateType: 'percent' };

  it('flags a zero-rated line mapped to a withholding or positive tax, but not to 0%', () => {
    expect(zeroRateTaxConflict({ taxTyCd: 'C' }, WH)).toMatch(/"2% WH" is a withholding tax \(-2%\)/);
    expect(zeroRateTaxConflict({ taxTyCd: 'A' }, SIXTEEN)).toMatch(/charges 16%/);
    expect(zeroRateTaxConflict({ taxTyCd: 'B', taxRate: 0 }, WH)).not.toBeNull();
    expect(zeroRateTaxConflict({ taxTyCd: 'C' }, ZERO)).toBeNull();
  });

  it('allows a 16% line mapped to 16% and never blocks when the rate is unknown or a group', () => {
    expect(zeroRateTaxConflict({ taxTyCd: 'B', taxRate: 16 }, SIXTEEN)).toBeNull();
    expect(zeroRateTaxConflict({ taxTyCd: 'C' }, { name: 'QB 16%', rate: undefined })).toBeNull();
    expect(zeroRateTaxConflict({ taxTyCd: 'C' }, { name: 'Grp', rate: 5, rateType: 'group' })).toBeNull();
  });

  it('rejects saving a zero-rated KRA type onto a withholding tax, and saves 0% and 16%->16%', async () => {
    const { service, rows, mainApiPull } = makeService();
    mainApiPull.getBillMappingOptions.mockResolvedValue({ ...OPTIONS, taxes: [WH, ZERO, SIXTEEN] });

    await expect(service.save(TENANT_ID, { taxes: { C: '7' } }, null)).rejects.toThrow(
      /KRA tax type C is zero-rated, but "2% WH" is a withholding tax/,
    );
    expect(rows).toHaveLength(0);

    await service.save(TENANT_ID, { taxes: { C: '8', B: '9' } }, null);
    expect(rows.map((r) => `${r.taxTyCd}:${r.erpId}`).sort()).toEqual(['B:9', 'C:8']);
  });

  it('findLineTaxConflicts names the offending line and skips lines it cannot judge', async () => {
    const { service, mainApiPull } = makeService();
    mainApiPull.getBillMappingOptions.mockResolvedValue({ ...OPTIONS, taxes: [WH, SIXTEEN] });
    const mapping = { connectionId: 'conn-1', mainApiApiKey: 'key-1' };

    const messages = await service.findLineTaxConflicts(mapping, [
      { description: 'Bread', taxTyCd: 'C', taxRate: 0, tax: { erpId: '7', erpName: '2% WH' } },
      { description: 'Fuel', taxTyCd: 'B', taxRate: 16, tax: { erpId: '9', erpName: '16% VAT' } },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/Line "Bread" is zero-rated \(KRA tax type C\) but "2% WH" is a withholding tax/);

    mainApiPull.getBillMappingOptions.mockRejectedValue(new Error('down'));
    await expect(
      service.findLineTaxConflicts(mapping, [
        { description: 'Bread', taxTyCd: 'C', taxRate: 0, tax: { erpId: '7', erpName: '2% WH' } },
      ]),
    ).resolves.toEqual([]);
  });
});
