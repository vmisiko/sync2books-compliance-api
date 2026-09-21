import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import {
  IDEMPOTENCY_KEY_HEADER,
  parseIdempotencyKey,
} from '../../domain/idempotency-key';

/**
 * The caller's `Idempotency-Key`, validated, or null when they sent none.
 * Throws 400 on a malformed one rather than ignoring it — a caller who believes
 * they are protected against a double-submit and is not would find out by
 * filing two invoices with KRA.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null =>
    parseIdempotencyKey(
      ctx.switchToHttp().getRequest<Request>().header(IDEMPOTENCY_KEY_HEADER),
    ),
);
