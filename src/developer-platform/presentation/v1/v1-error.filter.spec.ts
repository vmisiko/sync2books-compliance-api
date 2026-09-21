import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InsufficientStockError } from '../../../inventory/domain/errors/insufficient-stock.error';
import { ItemNotReadyForEtimsError } from '../../../sales/domain/errors/item-not-ready-for-etims.error';
import { V1ExceptionFilter } from './v1-error.filter';

function run(exception: unknown): { status: number; body: any } {
  let status = 0;
  let body: any;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
    },
  };
  new V1ExceptionFilter().catch(exception, {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost);
  return { status, body };
}

describe('V1ExceptionFilter', () => {
  it('wraps an HTTP exception in the one error shape', () => {
    const { status, body } = run(new BadRequestException('quantity must be a number'));
    expect(status).toBe(400);
    expect(body).toEqual({
      error: { code: 'invalid_request', message: 'quantity must be a number' },
    });
  });

  it.each([
    [new UnauthorizedException('Invalid API key'), 401, 'invalid_api_key'],
    [new ForbiddenException('no'), 403, 'forbidden'],
    [new ConflictException('dup'), 409, 'conflict'],
    [new HttpException('slow down', 429), 429, 'rate_limited'],
  ])('maps %#', (exception, status, code) => {
    const out = run(exception);
    expect(out.status).toBe(status);
    expect(out.body.error.code).toBe(code);
  });

  // KRA's refusal carries the document, so a caller can see and retry it.
  it('lets a thrower name its own code and attach the sale', () => {
    const { status, body } = run(
      new UnprocessableEntityException({
        code: 'kra_rejected',
        message: 'Invalid itemCd',
        sale: { id: 'doc-1', status: 'failed' },
      }),
    );
    expect(status).toBe(422);
    expect(body.error).toEqual({
      code: 'kra_rejected',
      message: 'Invalid itemCd',
      sale: { id: 'doc-1', status: 'failed' },
    });
  });

  it('joins an array message', () => {
    const { body } = run(new BadRequestException({ message: ['a is bad', 'b is bad'] }));
    expect(body.error.message).toBe('a is bad; b is bad');
  });

  it('maps known domain errors', () => {
    expect(run(new InsufficientStockError('Have 1, tried 5')).status).toBe(409);
    expect(run(new InsufficientStockError('x')).body.error.code).toBe('insufficient_stock');
    const notReady = run(new ItemNotReadyForEtimsError('Item is PENDING'));
    expect(notReady.status).toBe(422);
    expect(notReady.body.error.code).toBe('item_not_registered');
  });

  // The message of an unexpected exception can name tables, ids and other
  // tenants' data. None of that goes to an integrator.
  it('answers an unexpected error with a generic 500 and never its message', () => {
    const { status, body } = run(
      new Error('Table compliance_documents: duplicate entry for tenant abc-123'),
    );
    expect(status).toBe(500);
    expect(body.error.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('compliance_documents');
    expect(JSON.stringify(body)).not.toContain('abc-123');
  });

  it('survives a thrown non-Error', () => {
    expect(run('boom').status).toBe(500);
  });
});
