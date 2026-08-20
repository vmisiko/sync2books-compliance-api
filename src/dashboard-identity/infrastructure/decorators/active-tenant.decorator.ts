import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** The business id resolved and verified by ActiveTenantGuard — apply both together. */
export const ActiveTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { activeTenantId?: string }>();
    return req.activeTenantId as string;
  },
);
