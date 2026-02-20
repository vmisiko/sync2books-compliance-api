import { Inject, Injectable } from '@nestjs/common';
import { registerItem } from '../application/use-cases/register-item.usecase';
import { listItems } from '../application/use-cases/list-items.usecase';
import type { ICatalogItemRepository } from '../domain/ports/item-repository.port';
import type { IClassificationResolver } from '../domain/ports/classification-resolver.port';
import { ItemType } from '../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';
import {
  CATALOG_ITEM_REPO,
  CLASSIFICATION_RESOLVER,
} from '../../shared/tokens';

@Injectable()
export class CatalogService {
  constructor(
    @Inject(CATALOG_ITEM_REPO)
    private readonly itemRepo: ICatalogItemRepository,
    @Inject(CLASSIFICATION_RESOLVER)
    private readonly classificationResolver: IClassificationResolver,
  ) {}

  async registerItem(params: {
    merchantId: string;
    externalId: string;
    name: string;
    sku?: string | null;
    itemType: ItemType;
    taxCategory: TaxCategory;
    classificationCode?: string;
    unitCode?: string;
    internalUnit?: string;
    packagingUnitCode?: string;
    taxTyCd?: string;
    productTypeCode?: string;
  }) {
    return registerItem(params, this.itemRepo, this.classificationResolver);
  }

  async listItems(merchantId: string) {
    return listItems({ merchantId }, this.itemRepo);
  }
}
