import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { InsufficientStockError } from '../../../inventory/domain/errors/insufficient-stock.error';
import { ItemNotReadyForEtimsError } from '../../../sales/domain/errors/item-not-ready-for-etims.error';

/**
 * One error shape for the whole public API:
 *
 *   { "error": { "code": "invalid_request", "message": "...", ...extras } }
 *
 * `code` is the stable, machine-readable part a client branches on; `message`
 * is for a human and may change. Guard failures (bad key, missing scope, wrong
 * environment, rate limit) go through this too, because a filter bound to the
 * controller also catches what its guards throw -- so a developer meets one
 * shape whether the request died at authentication or in the business logic.
 *
 * Anything that is not an HttpException and not a known domain error is a bug
 * on our side. It is logged in full and answered with a generic 500: the
 * message of an unexpected exception can name tables, ids and other tenants'
 * data, and none of that belongs in a response to an integrator.
 */
@Catch()
export class V1ExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('V1');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const { message, extras } = readHttpException(exception);
      res.status(status).json({
        error: { code: codeForStatus(status), message, ...extras },
      });
      return;
    }

    if (exception instanceof InsufficientStockError) {
      res.status(HttpStatus.CONFLICT).json({
        error: { code: 'insufficient_stock', message: exception.message },
      });
      return;
    }

    if (exception instanceof ItemNotReadyForEtimsError) {
      res.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        error: {
          code: 'item_not_registered',
          message: `${exception.message} Register the item with KRA (POST /v1/items/{id}/register) before selling it.`,
        },
      });
      return;
    }

    this.logger.error(
      exception instanceof Error
        ? (exception.stack ?? exception.message)
        : String(exception),
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'internal_error',
        message: 'Something went wrong on our side. Retry, and contact support if it persists.',
      },
    });
  }
}

export function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'invalid_request';
    case 401:
      return 'invalid_api_key';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal_error' : 'error';
  }
}

/**
 * Nest exceptions carry their detail as a string, a `{ message }` object, or
 * (from ValidationPipe-style throwers) a `{ message: string[] }`. Normalises
 * all of them to one message, and lets a thrower attach structured extras
 * (`kra_rejected` carries the sale) under the same envelope.
 */
function readHttpException(exception: HttpException): {
  message: string;
  extras: Record<string, unknown>;
} {
  const response = exception.getResponse();
  if (typeof response === 'string') return { message: response, extras: {} };

  const body = response as Record<string, unknown>;
  const rawMessage = body.message;
  const message = Array.isArray(rawMessage)
    ? rawMessage.join('; ')
    : typeof rawMessage === 'string'
      ? rawMessage
      : exception.message;

  const {
    message: _message,
    error: _error,
    statusCode: _statusCode,
    code,
    ...extras
  } = body;
  // A thrower may name its own code (kra_rejected); otherwise the status decides.
  return {
    message,
    extras: typeof code === 'string' ? { ...extras, code } : extras,
  };
}
