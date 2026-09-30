import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { ApiCaller, ApiKeyRequest } from '../guards/api-caller';

/** The authenticated API key's context. Only valid behind ComplianceApiKeyGuard. */
export const AuthenticatedApiCaller = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiCaller | undefined =>
    ctx.switchToHttp().getRequest<ApiKeyRequest>().apiCaller,
);

/** The business this request was scoped to. Only valid behind TenantScopeGuard. */
export const ApiTenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<ApiKeyRequest>().apiTenantId,
);

/**
 * The business this request was scoped to, required.
 *
 * TenantScopeGuard leaves a request that names no business alone, so a route
 * that acts on a business needs this instead of ApiTenantId: without it, a
 * request that simply omitted `businessId` would reach the handler with no
 * tenant and nothing to stop it. Asking for the business is a 400, never a
 * default.
 */
export const RequiredApiTenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const tenantId = ctx.switchToHttp().getRequest<ApiKeyRequest>().apiTenantId;
    if (!tenantId) {
      throw new BadRequestException(
        'businessId is required. List your businesses with GET /v1/businesses.',
      );
    }
    return tenantId;
  },
);
