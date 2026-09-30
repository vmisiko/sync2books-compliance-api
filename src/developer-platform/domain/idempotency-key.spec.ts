import { BadRequestException } from '@nestjs/common';
import { parseIdempotencyKey } from './idempotency-key';

describe('parseIdempotencyKey', () => {
  it('accepts a reasonable key', () => {
    expect(parseIdempotencyKey('order-2026-09-21-0042')).toBe(
      'order-2026-09-21-0042',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(parseIdempotencyKey('  order-0042-abc  ')).toBe('order-0042-abc');
  });

  it.each([[undefined], [null], [''], ['   ']])(
    'treats %p as "not supplied"',
    (raw) => {
      expect(parseIdempotencyKey(raw)).toBeNull();
    },
  );

  // A key this short collides with the caller's own unrelated documents, since
  // it becomes part of merchantId:sourceDocumentId:documentType.
  it('rejects a key too short to be distinctive', () => {
    expect(() => parseIdempotencyKey('abc')).toThrow(BadRequestException);
  });

  it('rejects a key longer than the column allows', () => {
    expect(() => parseIdempotencyKey('a'.repeat(129))).toThrow(
      BadRequestException,
    );
  });

  it.each([['has space here'], ['slash/es/here'], ['semi;colon;here']])(
    'rejects %p, which would not survive the composite key',
    (raw) => {
      expect(() => parseIdempotencyKey(raw)).toThrow(BadRequestException);
    },
  );

  it('rejects a non-string header', () => {
    expect(() => parseIdempotencyKey(['a-valid-looking-key'])).toThrow(
      BadRequestException,
    );
  });
});
