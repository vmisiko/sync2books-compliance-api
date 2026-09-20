import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AssertedMerchantGuard } from './asserted-merchant.guard';
import { ASSERTED_COMPANY_ID } from './compliance-service-auth.guard';

function ctx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AssertedMerchantGuard', () => {
  const guard = new AssertedMerchantGuard();

  it('allows a payload naming the company the caller authenticated as', () => {
    const req = {
      [ASSERTED_COMPANY_ID]: 'company-1',
      params: {},
      query: {},
      body: { merchantId: 'company-1' },
    };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });

  // The service token authenticates *main API*, never *which tenant it may act
  // for* -- without this the token is a master key over every tenant's KRA device.
  it.each([
    ['body', { params: {}, query: {}, body: { merchantId: 'company-2' } }],
    ['query', { params: {}, query: { merchantId: 'company-2' }, body: {} }],
    ['path param', { params: { merchantId: 'company-2' }, query: {}, body: {} }],
  ])('rejects a merchantId from the %s that belongs to another company', (_where, parts) => {
    const req = { [ASSERTED_COMPANY_ID]: 'company-1', ...parts };
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  it('stands aside when nothing was asserted (local dev, token unset)', () => {
    const req = { params: {}, query: {}, body: { merchantId: 'anything' } };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });

  it('allows routes that carry no merchantId -- they are scoped by resource id', () => {
    const req = {
      [ASSERTED_COMPANY_ID]: 'company-1',
      params: { id: 'doc-1' },
      query: {},
      body: {},
    };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });
});
