import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import { RATE_LIMIT_STORE } from '../../../shared/tokens';
import type { IRateLimitStore } from '../../application/ports/rate-limit-store.port';
import type { ApiKeyRequest } from './api-caller';

const WINDOW_SECONDS = 60;

/**
 * Per-application rate limiting, with the headers that make it usable.
 *
 * Limits are per *application*, not per key: rotating a key must not hand a
 * caller a second allowance, and an application's keys are one integration
 * sharing one budget.
 *
 * Every response carries `X-RateLimit-Limit/Remaining/Reset`, and a refusal
 * also carries `Retry-After`. A limit a client cannot see is a limit they can
 * only discover by being cut off mid-batch.
 */
@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: IRateLimitStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<ApiKeyRequest>();
    const res = http.getResponse<Response>();

    const caller = req.apiCaller;
    // Nothing authenticated yet: ComplianceApiKeyGuard will reject this request
    // anyway, and counting it would let an unauthenticated caller burn a real
    // application's budget.
    if (!caller) return true;

    const limit = Math.max(1, caller.rateLimitPerMin);
    const { count, resetAt } = await this.store.hit(
      caller.applicationId,
      WINDOW_SECONDS,
    );
    const remaining = Math.max(0, limit - count);
    const resetSeconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetSeconds));

    if (count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, resetSeconds)));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Rate limit of ${limit} requests per minute exceeded. Retry in ${resetSeconds}s.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
