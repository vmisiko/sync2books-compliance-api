import type { CatalogItem } from '../entities/catalog-item.entity';

export interface ICatalogItemRepository {
  save(item: CatalogItem): Promise<CatalogItem>;
  findById(id: string): Promise<CatalogItem | null>;
  findByIds(ids: string[]): Promise<CatalogItem[]>;
  findByMerchant(merchantId: string): Promise<CatalogItem[]>;
  /**
   * `sourceSystem`, when passed, scopes the match so two ERPs sharing the
   * same small numeric externalId for this merchant don't resolve to each
   * other's catalog row (see IClassificationResolver's doc comment for the
   * same reasoning). Omit only for pre-existing call sites that haven't
   * been updated to track their item's source yet -- new call sites should
   * always pass it when known.
   */
  findByMerchantAndExternalId(
    merchantId: string,
    externalId: string,
    sourceSystem?: string | null,
  ): Promise<CatalogItem | null>;
}
