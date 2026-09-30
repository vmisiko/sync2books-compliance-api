import { sourceSystemForIntegrationKey } from './erp-contact-sync';

describe('sourceSystemForIntegrationKey', () => {
  it('matches the SourceSystem enum a pull writes, including hyphenated Business Central', () => {
    expect(sourceSystemForIntegrationKey('quickbooks')).toBe('QUICKBOOKS');
    expect(sourceSystemForIntegrationKey('odoo')).toBe('ODOO');
    expect(
      sourceSystemForIntegrationKey('microsoft-dynamics-365-business-central'),
    ).toBe('MICROSOFT_DYNAMICS_365_BUSINESS_CENTRAL');
  });
});
