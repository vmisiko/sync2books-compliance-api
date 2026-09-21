import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
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
