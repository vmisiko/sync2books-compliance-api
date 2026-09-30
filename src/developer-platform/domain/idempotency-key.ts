import { BadRequestException } from '@nestjs/common';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
/** Deliberately narrow: this value ends up inside a composite database key. */
const ALLOWED = /^[A-Za-z0-9._:-]+$/;

/**
 * Validates a caller-supplied `Idempotency-Key`.
 *
 * The document layer already dedupes on
 * `merchantId:sourceDocumentId:documentType`, so a retried POST is safe as long
 * as the caller names the same document twice. This header is how a caller says
 * so when their own system has no stable document id to send — it becomes the
 * `sourceDocumentId`, and replaying it returns the original document rather than
 * filing a second invoice with KRA.
 *
 * A short or random-per-attempt key defeats the point, so the minimum length is
 * enforced rather than suggested: a caller who sends `1` on every retry would
 * silently collide with their own unrelated documents.
 */
export function parseIdempotencyKey(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new BadRequestException('Idempotency-Key must be a string');
  }
  const value = raw.trim();
  if (value === '') return null;

  if (value.length < MIN_LENGTH || value.length > MAX_LENGTH) {
    throw new BadRequestException(
      `Idempotency-Key must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters`,
    );
  }
  if (!ALLOWED.test(value)) {
    throw new BadRequestException(
      'Idempotency-Key may only contain letters, digits, and . _ : -',
    );
  }
  return value;
}
