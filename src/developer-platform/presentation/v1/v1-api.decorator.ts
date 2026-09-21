import { applyDecorators, UseFilters, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { API_KEY_HEADER } from '../../domain/api-key';
import { ApiRateLimitGuard } from '../../infrastructure/guards/api-rate-limit.guard';
import { ComplianceApiKeyGuard } from '../../infrastructure/guards/compliance-api-key.guard';
import { TenantScopeGuard } from '../../infrastructure/guards/tenant-scope.guard';
import { V1ExceptionFilter } from './v1-error.filter';

/**
 * Everything a public `/v1` controller must carry, in one place, so a new
 * controller cannot be mounted with one of them forgotten.
 *
 * Guard order is the point: authenticate -> count against the limit -> bind to
 * a business. Authentication first so an unauthenticated caller can never burn
 * a real application's rate budget; the limiter before the business lookup so
 * a caller hammering an id it does not own is throttled rather than free.
 * The filter gives guard failures and handler failures one error shape.
 *
 * `bindsBusiness: false` is for the two routes that legitimately act on no
 * particular business (`/v1/me`, `/v1/lookups`).
 */
export function V1Api(options: { bindsBusiness?: boolean } = {}) {
  const bindsBusiness = options.bindsBusiness ?? true;
  return applyDecorators(
    ApiTags('Compliance API v1'),
    ApiSecurity(API_KEY_HEADER),
    UseGuards(
      ComplianceApiKeyGuard,
      ApiRateLimitGuard,
      ...(bindsBusiness ? [TenantScopeGuard] : []),
    ),
    UseFilters(V1ExceptionFilter),
  );
}
