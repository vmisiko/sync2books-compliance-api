import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Repository } from 'typeorm';
import {
  computeNeedsClassificationMapping,
  computeNeedsClassificationReview,
  computeNeedsProductType,
  type CatalogItem,
} from '../../domain/entities/catalog-item.entity';
import type { ICatalogItemRepository } from '../../domain/ports/item-repository.port';
import type { IComplianceItemRepository } from '../../../shared/ports/repository.port';
import { CatalogItemOrmEntity } from './catalog-item.orm-entity';

function ormToDomain(row: CatalogItemOrmEntity): CatalogItem {
  return {
    id: row.id,
    merchantId: row.merchantId,
    externalId: row.externalId,
    name: row.name,
    sku: row.sku,
    taxCategory: row.taxCategory as CatalogItem['taxCategory'],
    classificationCode: row.classificationCode,
    unitCode: row.unitCode,
    packagingUnitCode: row.packagingUnitCode,
    needsClassificationMapping: computeNeedsClassificationMapping(
      row.classificationCode,
      row.unitCode,
      row.packagingUnitCode,
    ),
    taxTyCd: row.taxTyCd,
    productTypeCode: row.productTypeCode,
    needsProductType: computeNeedsProductType(row.productTypeCode),
    classificationMethod: row.classificationMethod,
    needsClassificationReview: computeNeedsClassificationReview(
      row.classificationMethod,
    ),
    unitPrice: row.unitPrice,
    originCountry: row.originCountry,
    sourceSystem: row.sourceSystem,
    isStockItem: row.isStockItem,
    registrationStatus: row.registrationStatus,
    etimsItemCode: row.etimsItemCode,
    lastSyncResultCd: row.lastSyncResultCd,
    lastSyncResultMsg: row.lastSyncResultMsg,
    lastSyncAttemptAt: row.lastSyncAttemptAt,
    version: row.version,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function domainToOrm(item: CatalogItem): CatalogItemOrmEntity {
  const e = new CatalogItemOrmEntity();
  e.id = item.id;
  e.merchantId = item.merchantId;
  e.externalId = item.externalId;
  e.name = item.name;
  e.sku = item.sku;
  e.taxCategory = item.taxCategory;
  e.classificationCode = item.classificationCode;
  e.unitCode = item.unitCode;
  e.packagingUnitCode = item.packagingUnitCode;
  e.taxTyCd = item.taxTyCd;
  e.productTypeCode = item.productTypeCode;
  e.classificationMethod = item.classificationMethod;
  e.unitPrice = item.unitPrice;
  e.originCountry = item.originCountry;
  e.sourceSystem = item.sourceSystem;
  e.isStockItem = item.isStockItem;
  e.registrationStatus = item.registrationStatus;
  e.etimsItemCode = item.etimsItemCode;
  e.lastSyncResultCd = item.lastSyncResultCd;
  e.lastSyncResultMsg = item.lastSyncResultMsg;
  e.lastSyncAttemptAt = item.lastSyncAttemptAt;
  e.version = item.version;
  e.lastSyncedAt = item.lastSyncedAt;
  e.createdAt = item.createdAt;
  e.updatedAt = item.updatedAt;
  return e;
}

@Injectable()
export class CatalogItemTypeOrmRepository
  implements ICatalogItemRepository, IComplianceItemRepository
{
  constructor(
    @InjectRepository(CatalogItemOrmEntity)
    private readonly repo: Repository<CatalogItemOrmEntity>,
  ) {}

  async save(item: CatalogItem): Promise<CatalogItem> {
    const entity = domainToOrm(item);
    const saved = await this.repo.save(entity);
    return ormToDomain(saved);
  }

  async findById(id: string): Promise<CatalogItem | null> {
    const row = await this.repo.findOne({ where: { id } });
    return row ? ormToDomain(row) : null;
  }

  async findByIds(ids: string[]): Promise<CatalogItem[]> {
    if (ids.length === 0) return [];
    const rows = await this.repo
      .createQueryBuilder('item')
      .where('item.id IN (:...ids)', { ids })
      .getMany();
    return rows.map(ormToDomain);
  }

  async findByMerchant(merchantId: string): Promise<CatalogItem[]> {
    const rows = await this.repo.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
    });
    return rows.map(ormToDomain);
  }

  async findByMerchantAndExternalId(
    merchantId: string,
    externalId: string,
    sourceSystem?: string | null,
  ): Promise<CatalogItem | null> {
    const row = await this.repo.findOne({
      where:
        sourceSystem !== undefined
          ? { merchantId, externalId, sourceSystem: sourceSystem ?? IsNull() }
          : { merchantId, externalId },
    });
    return row ? ormToDomain(row) : null;
  }

  async findByMerchantAndName(
    merchantId: string,
    name: string,
  ): Promise<CatalogItem | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const row = await this.repo.findOne({
      where: { merchantId, name: ILike(trimmed) },
    });
    return row ? ormToDomain(row) : null;
  }
}
