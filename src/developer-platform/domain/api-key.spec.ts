import { ConnectionEnvironment } from '../../shared/domain/enums/connection-environment.enum';
import {
  apiKeyHashesEqual,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
} from './api-key';

describe('api-key', () => {
  it('generates a sandbox key that names its environment', () => {
    const key = generateApiKey(ConnectionEnvironment.SANDBOX);
    expect(key.plaintext).toMatch(/^cmp_sk_test_[0-9a-f]{32}$/);
    expect(key.keyPrefix).toBe(key.plaintext.slice(0, 'cmp_sk_test_'.length + 4));
    expect(key.lastFour).toBe(key.plaintext.slice(-4));
  });

  it('generates a production key that names its environment', () => {
    const key = generateApiKey(ConnectionEnvironment.PRODUCTION);
    expect(key.plaintext).toMatch(/^cmp_sk_live_[0-9a-f]{32}$/);
  });

  // A leaked row must not be replayable -- this is the whole reason the key is
  // stored as a digest rather than as itself.
  it('stores only a hash, never the secret', () => {
    const key = generateApiKey(ConnectionEnvironment.SANDBOX);
    expect(key.keyHash).toHaveLength(64);
    expect(key.keyHash).not.toContain(key.plaintext);
    expect(key.keyHash).toBe(hashApiKey(key.plaintext));
  });

  it('never repeats a key', () => {
    const seen = new Set(
      Array.from({ length: 200 }, () =>
        generateApiKey(ConnectionEnvironment.SANDBOX).plaintext,
      ),
    );
    expect(seen.size).toBe(200);
  });

  it('compares hashes without a length-dependent shortcut', () => {
    const a = hashApiKey('one');
    expect(apiKeyHashesEqual(a, a)).toBe(true);
    expect(apiKeyHashesEqual(a, hashApiKey('two'))).toBe(false);
    expect(apiKeyHashesEqual(a, 'short')).toBe(false);
  });

  it.each([
    ['cmp_sk_test_0123456789abcdef0123456789abcdef', true],
    ['cmp_sk_live_0123456789abcdef0123456789abcdef', true],
    ['cmp_sk_prod_0123456789abcdef0123456789abcdef', false],
    ['cmp_sk_test_0123456789ABCDEF0123456789ABCDEF', false],
    ['cmp_sk_test_tooshort', false],
    ['Bearer eyJhbGciOiJIUzI1NiJ9.e30.x', false],
    ['', false],
  ])('shape-checks %s -> %s', (value, expected) => {
    expect(looksLikeApiKey(value)).toBe(expected);
  });
});
