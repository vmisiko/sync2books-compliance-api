import { BadRequestException } from '@nestjs/common';
import {
  objectAt,
  optionalNumber,
  optionalString,
  readBody,
  readPageSize,
  requiredArray,
  requiredDate,
  requiredEnum,
  requiredNumber,
  requiredString,
  withIndex,
} from './v1-input';

describe('v1 input readers', () => {
  describe('readBody', () => {
    it.each([[null], [undefined], ['text'], [42], [[1, 2]]])(
      'rejects %p as a body',
      (value) => {
        expect(() => readBody(value)).toThrow(BadRequestException);
      },
    );
    it('accepts an object', () => {
      expect(readBody({ a: 1 })).toEqual({ a: 1 });
    });
  });

  describe('strings', () => {
    it('trims, and treats blank as absent', () => {
      expect(optionalString({ a: '  hi  ' }, 'a')).toBe('hi');
      expect(optionalString({ a: '   ' }, 'a')).toBeUndefined();
      expect(optionalString({}, 'a')).toBeUndefined();
    });
    it('rejects a non-string rather than coercing it', () => {
      expect(() => optionalString({ a: 5 }, 'a')).toThrow(BadRequestException);
      expect(() => requiredString({ a: { x: 1 } }, 'a')).toThrow(BadRequestException);
    });
    it('names the missing field', () => {
      expect(() => requiredString({}, 'traderInvoiceNumber')).toThrow(
        'traderInvoiceNumber is required',
      );
    });
    it('enforces a maximum length', () => {
      expect(() => requiredString({ a: 'x'.repeat(6) }, 'a', { max: 5 })).toThrow(
        BadRequestException,
      );
    });
  });

  // Money. A numeric string that slips through becomes "105" the moment a
  // downstream reduce forgets it is not a number.
  describe('numbers', () => {
    it('accepts a JSON number', () => {
      expect(requiredNumber({ q: 2.5 }, 'q')).toBe(2.5);
    });
    it.each([['"10"', '10'], ['NaN', NaN], ['Infinity', Infinity], ['null', null], ['bool', true]])(
      'rejects %s',
      (_label, value) => {
        expect(() => requiredNumber({ q: value }, 'q')).toThrow(BadRequestException);
      },
    );
    it('enforces bounds', () => {
      expect(() => requiredNumber({ q: 0 }, 'q', { exclusiveMin: 0 })).toThrow(
        BadRequestException,
      );
      expect(() => requiredNumber({ q: -1 }, 'q', { min: 0 })).toThrow(
        BadRequestException,
      );
      expect(requiredNumber({ q: 0 }, 'q', { min: 0 })).toBe(0);
    });
    it('optionalNumber returns undefined when absent, still validates when present', () => {
      expect(optionalNumber({}, 'p')).toBeUndefined();
      expect(() => optionalNumber({ p: 'x' }, 'p')).toThrow(BadRequestException);
    });
  });

  describe('enum', () => {
    it('accepts an allowed value and names the options otherwise', () => {
      expect(requiredEnum({ a: 'ADD' }, 'a', ['ADD', 'DEDUCT'] as const)).toBe('ADD');
      expect(() => requiredEnum({ a: 'ZAP' }, 'a', ['ADD', 'DEDUCT'] as const)).toThrow(
        'a must be one of: ADD, DEDUCT',
      );
    });
  });

  describe('dates', () => {
    it('accepts a real date', () => {
      expect(requiredDate({ d: '2026-09-21' }, 'd')).toBe('2026-09-21');
    });
    it.each([['21/09/2026'], ['2026-9-1'], ['2026-02-31'], ['2026-13-01'], ['not a date']])(
      'rejects %s',
      (value) => {
        expect(() => requiredDate({ d: value }, 'd')).toThrow(BadRequestException);
      },
    );
  });

  describe('arrays', () => {
    it('enforces min and max', () => {
      expect(() => requiredArray({ a: [] }, 'a', { min: 1 })).toThrow(BadRequestException);
      expect(() => requiredArray({ a: [1, 2, 3] }, 'a', { max: 2 })).toThrow(BadRequestException);
      expect(() => requiredArray({}, 'a')).toThrow(BadRequestException);
    });
    it('labels an element error with its position', () => {
      const lines = [{ quantity: 1 }, { quantity: 'x' }];
      expect(() =>
        withIndex('lines', 1, () =>
          requiredNumber(objectAt(lines, 1, 'lines'), 'quantity'),
        ),
      ).toThrow('lines[1].quantity must be a number');
    });
    it('rejects a non-object element', () => {
      expect(() => objectAt([1], 0, 'lines')).toThrow('lines[0] must be an object');
    });
  });

  describe('readPageSize', () => {
    it('defaults, and refuses nonsense instead of clamping it', () => {
      expect(readPageSize(undefined)).toBe(20);
      expect(readPageSize('50')).toBe(50);
      expect(() => readPageSize('0')).toThrow(BadRequestException);
      expect(() => readPageSize('101')).toThrow(BadRequestException);
      expect(() => readPageSize('abc')).toThrow(BadRequestException);
      expect(() => readPageSize('1.5')).toThrow(BadRequestException);
    });
  });
});
