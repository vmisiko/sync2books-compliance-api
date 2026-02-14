import type { CatalogItem } from '../../domain/entities/catalog-item.entity';
import type { ICatalogItemRepository } from '../../domain/ports/item-repository.port';

export interface ListItemsInput {
  merchantId: string;
}

export interface ListItemsResult {
  items: CatalogItem[];
}

export async function listItems(
  input: ListItemsInput,
  itemRepo: ICatalogItemRepository,
): Promise<ListItemsResult> {
  const items = await itemRepo.findByMerchant(input.merchantId);
  return { items };
}
