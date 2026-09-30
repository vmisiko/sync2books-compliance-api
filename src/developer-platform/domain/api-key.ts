import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ConnectionEnvironment } from '../../shared/domain/enums/connection-environment.enum';

/**
 * Key format: `cmp_sk_test_<32 hex>` / `cmp_sk_live_<32 hex>`.
 *
 * The environment is in the string itself so a key is recognisable in a log or
 * a support ticket without a database lookup — but it is never *trusted* from
 * the string: the authoritative environment is the stored column, and the
 * guard reads it from there.
 */
const PREFIX = 'cmp_sk';
const SECRET_BYTES = 16; // 32 hex characters
/** Characters of the secret kept in `keyPrefix`, enough to tell two keys apart. */
const PREFIX_SECRET_CHARS = 4;

export const API_KEY_HEADER = 'x-api-key';

function environmentSlug(environment: ConnectionEnvironment): string {
  return environment === ConnectionEnvironment.PRODUCTION ? 'live' : 'test';
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Compares two hashes without leaking, through timing, how far they matched.
 * Both are hex SHA-256 digests, so a length difference means the input was
 * never a hash of ours and can be rejected outright.
 */
export function apiKeyHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type GeneratedApiKey = {
  /** The full secret. Shown to the user once and never stored. */
  plaintext: string;
  keyPrefix: string;
  keyHash: string;
  lastFour: string;
};

export function generateApiKey(
  environment: ConnectionEnvironment,
): GeneratedApiKey {
  const secret = randomBytes(SECRET_BYTES).toString('hex');
  const plaintext = `${PREFIX}_${environmentSlug(environment)}_${secret}`;
  return {
    plaintext,
    keyPrefix: `${PREFIX}_${environmentSlug(environment)}_${secret.slice(
      0,
      PREFIX_SECRET_CHARS,
    )}`,
    keyHash: hashApiKey(plaintext),
    lastFour: secret.slice(-4),
  };
}

/**
 * Cheap shape check before touching the database, so a stray Authorization
 * header or a main-API key pasted into the wrong field costs a string compare
 * rather than a query.
 */
export function looksLikeApiKey(value: string): boolean {
  return /^cmp_sk_(test|live)_[0-9a-f]{32}$/.test(value);
}
