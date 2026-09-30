/**
 * Scopes a merchant's API key can carry. Deliberately small: every scope here
 * maps onto something a merchant's own developer legitimately does, and
 * anything absent stays internal. Adding one is a product decision — a scope
 * that exists but is never checked is worse than no scope at all.
 */
export enum ApiKeyScope {
  CATALOG_READ = 'catalog:read',
  CATALOG_WRITE = 'catalog:write',
  SALES_READ = 'sales:read',
  SALES_WRITE = 'sales:write',
  STOCK_WRITE = 'stock:write',
  LOOKUPS_READ = 'lookups:read',
}

export const ALL_API_KEY_SCOPES: ApiKeyScope[] = Object.values(ApiKeyScope);

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return (
    typeof value === 'string' &&
    (ALL_API_KEY_SCOPES as string[]).includes(value)
  );
}
