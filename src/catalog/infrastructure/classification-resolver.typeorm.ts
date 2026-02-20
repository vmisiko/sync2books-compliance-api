import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Repository } from 'typeorm';
import type {
  ClassificationResolution,
  IClassificationResolver,
} from '../domain/ports/classification-resolver.port';
import { TaxMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';
import { UnitMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/unit-mapping.orm-entity';
import { ClassificationMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';

@Injectable()
export class ClassificationResolverTypeOrm implements IClassificationResolver {
  constructor(
    @InjectRepository(TaxMappingOrmEntity)
    private readonly taxRepo: Repository<TaxMappingOrmEntity>,
    @InjectRepository(UnitMappingOrmEntity)
    private readonly unitRepo: Repository<UnitMappingOrmEntity>,
    @InjectRepository(ClassificationMappingOrmEntity)
    private readonly clsRepo: Repository<ClassificationMappingOrmEntity>,
  ) {}

  async resolveClassification(params: {
    merchantId: string;
    itemType: string;
    itemName?: string;
    sku?: string;
    externalId?: string;
    classificationCode?: string;
    unitCode?: string;
    packagingUnitCode?: string;
    taxTyCd?: string;
    productTypeCode?: string;
    internalTaxCategory?: string;
    internalUnit?: string;
  }): Promise<ClassificationResolution> {
    const merchantId = params.merchantId;

    const productTypeCode =
      params.productTypeCode ?? inferProductTypeCode(params.itemType);

    const taxTyCd =
      params.taxTyCd ??
      (await this.resolveTaxTyCd(merchantId, params.internalTaxCategory));

    const unitMapping =
      params.unitCode && params.packagingUnitCode
        ? { qtyUnitCd: params.unitCode, pkgUnitCd: params.packagingUnitCode }
        : await this.resolveUnits(merchantId, params.internalUnit);

    const classificationCode =
      params.classificationCode ??
      (await this.resolveItemClassification(merchantId, params));

    const source: ClassificationResolution['source'] =
      params.classificationCode ||
      params.unitCode ||
      params.packagingUnitCode ||
      params.taxTyCd ||
      params.productTypeCode
        ? 'merchant_override'
        : 'rule_based';

    return {
      classificationCode,
      unitCode: unitMapping.qtyUnitCd,
      packagingUnitCode: unitMapping.pkgUnitCd,
      taxTyCd,
      productTypeCode,
      source,
    };
  }

  private async resolveTaxTyCd(
    merchantId: string,
    internalTaxCategory?: string,
  ): Promise<string> {
    if (!internalTaxCategory) {
      throw new Error('Missing internalTaxCategory for tax mapping');
    }

    const merchant = await this.taxRepo.findOne({
      where: { merchantId, internalTaxCategory, active: true },
    });
    if (merchant) return merchant.taxTyCd;

    const global = await this.taxRepo.findOne({
      where: { merchantId: IsNull(), internalTaxCategory, active: true },
    });
    if (global) return global.taxTyCd;

    throw new Error(
      `Missing tax mapping for internalTaxCategory=${internalTaxCategory} (merchantId=${merchantId})`,
    );
  }

  private async resolveUnits(
    merchantId: string,
    internalUnit?: string,
  ): Promise<{ qtyUnitCd: string; pkgUnitCd: string }> {
    const unit = internalUnit ?? 'EA';

    const merchant = await this.unitRepo.findOne({
      where: { merchantId, internalUnit: unit, active: true },
    });
    if (merchant)
      return { qtyUnitCd: merchant.qtyUnitCd, pkgUnitCd: merchant.pkgUnitCd };

    const global = await this.unitRepo.findOne({
      where: { merchantId: IsNull(), internalUnit: unit, active: true },
    });
    if (global)
      return { qtyUnitCd: global.qtyUnitCd, pkgUnitCd: global.pkgUnitCd };

    throw new Error(
      `Missing unit mapping for internalUnit=${unit} (merchantId=${merchantId})`,
    );
  }

  private async resolveItemClassification(
    merchantId: string,
    params: {
      itemType: string;
      itemName?: string;
      sku?: string;
      externalId?: string;
    },
  ): Promise<string> {
    const type = params.itemType ?? null;

    if (params.externalId) {
      const m = await this.clsRepo.findOne({
        where: {
          merchantId,
          matchType: 'EXTERNAL_ID',
          matchValue: params.externalId,
          itemType: type,
          active: true,
        },
        order: { priority: 'ASC', updatedAt: 'DESC' },
      });
      if (m) return m.itemClsCd;
    }

    if (params.sku) {
      const m = await this.clsRepo.findOne({
        where: {
          merchantId,
          matchType: 'SKU',
          matchValue: params.sku,
          itemType: type,
          active: true,
        },
        order: { priority: 'ASC', updatedAt: 'DESC' },
      });
      if (m) return m.itemClsCd;
    }

    if (params.itemName) {
      const m = await this.clsRepo.findOne({
        where: {
          merchantId,
          matchType: 'NAME_CONTAINS',
          matchValue: ILike(`%${params.itemName}%`),
          itemType: type,
          active: true,
        },
        order: { priority: 'ASC', updatedAt: 'DESC' },
      });
      if (m) return m.itemClsCd;
    }

    const fallback = await this.clsRepo.findOne({
      where: { merchantId, source: 'default', active: true },
      order: { priority: 'ASC', updatedAt: 'DESC' },
    });
    if (fallback) return fallback.itemClsCd;

    throw new Error(
      `Missing classification mapping for item (merchantId=${merchantId}). Provide classificationCode or configure classification_mappings.`,
    );
  }
}

function inferProductTypeCode(itemType: string): string {
  // Default heuristic: GOODS -> finished product (2), SERVICE -> service (3)
  if (itemType === 'SERVICE') return '3';
  return '2';
}
