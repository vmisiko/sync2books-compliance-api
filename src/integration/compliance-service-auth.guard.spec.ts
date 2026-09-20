import {
  BadRequestException,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ASSERTED_COMPANY_ID,
  ComplianceServiceAuthGuard,
} from './compliance-service-auth.guard';

function ctx(headers: Record<string, string>): {
  context: ExecutionContext;
  req: Record<string, unknown>;
} {
  const req: Record<string, unknown> = { headers };
  return {
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
    req,
  };
}

describe('ComplianceServiceAuthGuard', () => {
  const OLD_ENV = { ...process.env };
  let guard: ComplianceServiceAuthGuard;

  beforeEach(() => {
    guard = new ComplianceServiceAuthGuard();
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('accepts a matching bearer token and records the asserted company', () => {
    process.env.COMPLIANCE_SERVICE_TOKEN = 'service-token';
    const { context, req } = ctx({
      authorization: 'Bearer service-token',
      'x-sync2books-company-id': 'company-1',
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(req[ASSERTED_COMPANY_ID]).toBe('company-1');
  });

  it('rejects a wrong token', () => {
    process.env.COMPLIANCE_SERVICE_TOKEN = 'service-token';
    const { context } = ctx({
      authorization: 'Bearer nope',
      'x-sync2books-company-id': 'company-1',
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('requires the company header even with a valid token', () => {
    process.env.COMPLIANCE_SERVICE_TOKEN = 'service-token';
    const { context } = ctx({ authorization: 'Bearer service-token' });

    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
  });

  // These routes reach a tenant's KRA device credentials; an unset token used to
  // wave every caller through, in any environment.
  it('fails closed in production when the token is not configured', () => {
    delete process.env.COMPLIANCE_SERVICE_TOKEN;
    process.env.NODE_ENV = 'production';
    const { context } = ctx({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('still allows an unconfigured token outside production, for local dev', () => {
    delete process.env.COMPLIANCE_SERVICE_TOKEN;
    process.env.NODE_ENV = 'development';
    const { context, req } = ctx({});

    expect(guard.canActivate(context)).toBe(true);
    expect(req[ASSERTED_COMPANY_ID]).toBeUndefined();
  });
});
