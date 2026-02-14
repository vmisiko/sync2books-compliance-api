import type { CatalogItem } from '../entities/catalog-item.entity';

export interface ICatalogItemRepository {
  save(item: CatalogItem): Promise<CatalogItem>;
  findById(id: string): Promise<CatalogItem | null>;
  findByIds(ids: string[]): Promise<CatalogItem[]>;
  findByMerchant(merchantId: string): Promise<CatalogItem[]>;
  findByMerchantAndExternalId(
    merchantId: string,
    externalId: string,
  ): Promise<CatalogItem | null>;
}
