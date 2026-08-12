import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { registerItem } from '../application/use-cases/register-item.usecase';
import { listItems } from '../application/use-cases/list-items.usecase';
import { syncItemsToEtims } from '../application/use-cases/sync-items.usecase';
import {
  searchItemClassifications,
  type SearchItemClassificationsInput,
} from '../application/use-cases/search-item-classifications.usecase';
import {
  syncItemClassifications,
  type SyncItemClassificationsInput,
} from '../application/use-cases/sync-item-classifications.usecase';
import {
  listCodeClasses,
  searchCodes,
  type SearchCodesInput,
} from '../application/use-cases/search-codes.usecase';
import {
  syncCodeList,
  type SyncCodeListInput,
} from '../application/use-cases/sync-code-list.usecase';
import type { ICatalogItemRepository } from '../domain/ports/item-repository.port';
import type { IClassificationResolver } from '../domain/ports/classification-resolver.port';
import { ItemType } from '../../shared/domain/enums/item-type.enum';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';
import {
  CATALOG_ITEM_REPO,
  CLASSIFICATION_RESOLVER,
  CONNECTION_REPO,
  ETIMS_ADAPTER,
} from '../../shared/tokens';
import type { IComplianceConnectionRepository } from '../../shared/ports/repository.port';
import type { IEtimsAdapter } from '../../regulatory/oscu/ports/etims-adapter.port';
import { OscuItemClassificationOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-item-classification.orm-entity';
import { OscuSyncStateOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-sync-state.orm-entity';
import { OscuCodeClassOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-code-class.orm-entity';
import { OscuCodeOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/oscu-code.orm-entity';

@Injectable()
export class CatalogService {
  constructor(
    @Inject(CATALOG_ITEM_REPO)
    private readonly itemRepo: ICatalogItemRepository,
    @Inject(CLASSIFICATION_RESOLVER)
    private readonly classificationResolver: IClassificationResolver,
    @Inject(CONNECTION_REPO)
    private readonly connectionRepo: IComplianceConnectionRepository,
    @Inject(ETIMS_ADAPTER)
    private readonly etimsAdapter: IEtimsAdapter,
    @InjectRepository(OscuItemClassificationOrmEntity)
    private readonly itemClassificationRepo: Repository<OscuItemClassificationOrmEntity>,
    @InjectRepository(OscuSyncStateOrmEntity)
    private readonly oscuSyncStateRepo: Repository<OscuSyncStateOrmEntity>,
    @InjectRepository(OscuCodeClassOrmEntity)
    private readonly codeClassRepo: Repository<OscuCodeClassOrmEntity>,
    @InjectRepository(OscuCodeOrmEntity)
    private readonly codeRepo: Repository<OscuCodeOrmEntity>,
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

  async getItemById(itemId: string) {
    return this.itemRepo.findById(itemId);
  }

  async findByExternalId(merchantId: string, externalId: string) {
    return this.itemRepo.findByMerchantAndExternalId(merchantId, externalId);
  }

  async syncItems(params: {
    merchantId: string;
    branchId: string;
    itemIds?: string[];
    onlyPending?: boolean;
    force?: boolean;
  }) {
    return syncItemsToEtims(params, {
      itemRepo: this.itemRepo,
      connectionRepo: this.connectionRepo,
      etimsAdapter: this.etimsAdapter,
      syncStateRepo: this.oscuSyncStateRepo,
    });
  }

  async searchItemClassifications(params: SearchItemClassificationsInput) {
    return searchItemClassifications(params, this.itemClassificationRepo);
  }

  async getItemClassification(itemClsCd: string) {
    return this.itemClassificationRepo.findOne({ where: { itemClsCd } });
  }

  async syncItemClassifications(params: SyncItemClassificationsInput) {
    return syncItemClassifications(params, {
      connectionRepo: this.connectionRepo,
      etimsAdapter: this.etimsAdapter,
      classificationRepo: this.itemClassificationRepo,
      syncStateRepo: this.oscuSyncStateRepo,
    });
  }

  async listCodeClasses(includeInactive = false) {
    return listCodeClasses(this.codeClassRepo, includeInactive);
  }

  async searchCodes(params: SearchCodesInput) {
    return searchCodes(params, this.codeRepo);
  }

  async syncCodeList(params: SyncCodeListInput) {
    return syncCodeList(params, {
      connectionRepo: this.connectionRepo,
      etimsAdapter: this.etimsAdapter,
      codeClassRepo: this.codeClassRepo,
      codeRepo: this.codeRepo,
      syncStateRepo: this.oscuSyncStateRepo,
    });
  }
}
