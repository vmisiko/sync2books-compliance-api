import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Repository } from 'typeorm';
import type {
  ClassificationResolution,
  IClassificationResolver,
} from '../domain/ports/classification-resolver.port';
import { TaxMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';
import { ClassificationMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/classification-mapping.orm-entity';

@Injectable()
export class ClassificationResolverTypeOrm implements IClassificationResolver {
  constructor(
    @InjectRepository(TaxMappingOrmEntity)
    private readonly taxRepo: Repository<TaxMappingOrmEntity>,
    @InjectRepository(ClassificationMappingOrmEntity)
    private readonly clsRepo: Repository<ClassificationMappingOrmEntity>,
  ) {}

  /**
   * Tax stays category-based (internalTaxCategory -> one shared, approved
   * tax_mappings row — KRA only has 5 tax types). Quantity/packaging unit
   * and classification are all resolved per item — the caller must supply
   * unitCode/packagingUnitCode/classificationCode directly (looked up from
   * that item's own classification_mappings row by the caller), since
   * there's no category table to fall back to for them anymore. Missing
   * any of the three throws a clear per-field error rather than silently
   * defaulting, mirroring how classification has always behaved.
   */
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
  }): Promise<ClassificationResolution> {
    const merchantId = params.merchantId;

    const productTypeCode =
      params.productTypeCode ?? inferProductTypeCode(params.itemType);

    const taxTyCd =
      params.taxTyCd ??
      (await this.resolveTaxTyCd(merchantId, params.internalTaxCategory));

    if (!params.unitCode) {
      throw new Error(
        `Missing qtyUnitCd for item (merchantId=${merchantId}). Resolve it on the item's classification_mappings row before registering.`,
      );
    }
    if (!params.packagingUnitCode) {
      throw new Error(
        `Missing pkgUnitCd for item (merchantId=${merchantId}). Resolve it on the item's classification_mappings row before registering.`,
      );
    }

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
      unitCode: params.unitCode,
      packagingUnitCode: params.packagingUnitCode,
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
    if (merchant) {
      // active:true rows are only ever set by DashboardMappingApplicationService's
      // approve()/update(), both of which require taxTyCd first — so this is a
      // data-integrity guard, not an expected path.
      if (!merchant.taxTyCd) {
        throw new Error(
          `Active tax mapping for internalTaxCategory=${internalTaxCategory} has no taxTyCd (merchantId=${merchantId})`,
        );
      }
      return merchant.taxTyCd;
    }

    const global = await this.taxRepo.findOne({
      where: { merchantId: IsNull(), internalTaxCategory, active: true },
    });
    if (global) {
      if (!global.taxTyCd) {
        throw new Error(
          `Active global tax mapping for internalTaxCategory=${internalTaxCategory} has no taxTyCd`,
        );
      }
      return global.taxTyCd;
    }

    throw new Error(
      `Missing tax mapping for internalTaxCategory=${internalTaxCategory} (merchantId=${merchantId})`,
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
      // itemClsCd can be null on Mapping Center's NEEDS_REVIEW placeholder
      // rows; those are always created with active: false so this shouldn't
      // trigger, but guard anyway rather than resolve a sale to a null code.
      if (m && m.itemClsCd) return m.itemClsCd;
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
      if (m && m.itemClsCd) return m.itemClsCd;
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
      if (m && m.itemClsCd) return m.itemClsCd;
    }

    const fallback = await this.clsRepo.findOne({
      where: { merchantId, source: 'default', active: true },
      order: { priority: 'ASC', updatedAt: 'DESC' },
    });
    if (fallback && fallback.itemClsCd) return fallback.itemClsCd;

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
