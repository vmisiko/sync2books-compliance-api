/**
 * Minimal Redis surface used by {@link RedisApigeeTokenCache} (implemented by `ioredis`).
 */
export type RedisLike = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
};
