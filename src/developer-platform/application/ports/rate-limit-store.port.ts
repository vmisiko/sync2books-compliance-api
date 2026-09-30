export type RateLimitHit = {
  /** Requests counted in the current window, including this one. */
  count: number;
  /** When the current window expires, as epoch milliseconds. */
  resetAt: number;
};

/**
 * A fixed-window counter. Deliberately not a token bucket: the limit we publish
 * in `X-RateLimit-*` has to be the limit we enforce, and a fixed window is the
 * one shape a client can reason about from those three headers alone.
 */
export interface IRateLimitStore {
  /** Records one request against `key` and returns the window's state. */
  hit(key: string, windowSeconds: number): Promise<RateLimitHit>;
  /** Which implementation is in use, so the API can say so honestly. */
  readonly kind: 'memory' | 'redis';
}
