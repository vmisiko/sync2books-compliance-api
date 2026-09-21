import { BadRequestException } from '@nestjs/common';

/**
 * Explicit input readers for `/v1`.
 *
 * The service has no global ValidationPipe, and the Swagger DTOs are
 * documentation only -- a request body arrives as whatever JSON the caller
 * sent. On an internal route that is tolerable; on a public API it means a
 * string where a number was expected reaches arithmetic and silently becomes
 * NaN on a fiscal document. Every `/v1` handler reads its input through these
 * so a bad request is a 400 that names the field, not a bad number filed
 * with KRA.
 *
 * Each reader takes the field name so the error can say which one, and
 * collects nothing: the first problem is reported. That is deliberately
 * simpler than a full validator -- the API is small and a caller fixes one
 * thing at a time.
 */

export type JsonObject = Record<string, unknown>;

export function readBody(body: unknown): JsonObject {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Request body must be a JSON object');
  }
  return body as JsonObject;
}

export function optionalString(
  source: JsonObject,
  field: string,
  opts: { max?: number } = {},
): string | undefined {
  const raw = source[field];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  const value = raw.trim();
  if (value === '') return undefined;
  if (opts.max !== undefined && value.length > opts.max) {
    throw new BadRequestException(
      `${field} must be at most ${opts.max} characters`,
    );
  }
  return value;
}

export function requiredString(
  source: JsonObject,
  field: string,
  opts: { max?: number } = {},
): string {
  const value = optionalString(source, field, opts);
  if (value === undefined) {
    throw new BadRequestException(`${field} is required`);
  }
  return value;
}

export function requiredNumber(
  source: JsonObject,
  field: string,
  opts: { min?: number; exclusiveMin?: number; max?: number } = {},
): number {
  const raw = source[field];
  if (raw === undefined || raw === null) {
    throw new BadRequestException(`${field} is required`);
  }
  // A JSON number only. A numeric *string* is refused: "10" + 5 is "105" the
  // moment a downstream reduce forgets, and quantities and prices are money.
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new BadRequestException(`${field} must be a number`);
  }
  if (opts.min !== undefined && raw < opts.min) {
    throw new BadRequestException(`${field} must be at least ${opts.min}`);
  }
  if (opts.exclusiveMin !== undefined && raw <= opts.exclusiveMin) {
    throw new BadRequestException(
      `${field} must be greater than ${opts.exclusiveMin}`,
    );
  }
  if (opts.max !== undefined && raw > opts.max) {
    throw new BadRequestException(`${field} must be at most ${opts.max}`);
  }
  return raw;
}

export function optionalNumber(
  source: JsonObject,
  field: string,
  opts: { min?: number; exclusiveMin?: number; max?: number } = {},
): number | undefined {
  if (source[field] === undefined || source[field] === null) return undefined;
  return requiredNumber(source, field, opts);
}

export function requiredEnum<T extends string>(
  source: JsonObject,
  field: string,
  allowed: readonly T[],
): T {
  const value = requiredString(source, field);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(
      `${field} must be one of: ${allowed.join(', ')}`,
    );
  }
  return value as T;
}

export function optionalEnum<T extends string>(
  source: JsonObject,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (optionalString(source, field) === undefined) return undefined;
  return requiredEnum(source, field, allowed);
}

/** `YYYY-MM-DD`, and a real calendar date (not `2026-02-31`). */
export function requiredDate(source: JsonObject, field: string): string {
  const value = requiredString(source, field);
  return assertIsoDate(value, field);
}

export function optionalDate(
  source: JsonObject,
  field: string,
): string | undefined {
  const value = optionalString(source, field);
  return value === undefined ? undefined : assertIsoDate(value, field);
}

function assertIsoDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must be a date as YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${field} is not a real calendar date`);
  }
  return value;
}

export function requiredArray(
  source: JsonObject,
  field: string,
  opts: { min?: number; max?: number } = {},
): unknown[] {
  const raw = source[field];
  if (!Array.isArray(raw)) {
    throw new BadRequestException(`${field} must be an array`);
  }
  if (opts.min !== undefined && raw.length < opts.min) {
    throw new BadRequestException(
      `${field} must contain at least ${opts.min} item${opts.min === 1 ? '' : 's'}`,
    );
  }
  if (opts.max !== undefined && raw.length > opts.max) {
    throw new BadRequestException(
      `${field} must contain at most ${opts.max} items`,
    );
  }
  return raw;
}

/** One element of an array field, as an object, with the index in any error. */
export function objectAt(
  values: unknown[],
  index: number,
  field: string,
): JsonObject {
  const value = values[index];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${field}[${index}] must be an object`);
  }
  return value as JsonObject;
}

/** Runs `read` and re-labels any 400 it throws with the array position. */
export function withIndex<T>(
  field: string,
  index: number,
  read: () => T,
): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string }).message ?? error.message);
      throw new BadRequestException(`${field}[${index}].${message}`);
    }
    throw error;
  }
}

/** Bounded page size for list routes; refuses nonsense rather than clamping it silently. */
export function readPageSize(raw: unknown, fallback = 20, max = 100): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestException(
      `pageSize must be a whole number between 1 and ${max}`,
    );
  }
  return parsed;
}
