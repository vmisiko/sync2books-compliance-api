import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type {
  ClassificationResolution,
  IClassificationResolver,
} from '../domain/ports/classification-resolver.port';
import { TaxMappingOrmEntity } from '../../regulatory/oscu/infrastructure/persistence/tax-mapping.orm-entity';

@Injectable()
export class ClassificationResolverTypeOrm implements IClassificationResolver {
  constructor(
    @InjectRepository(TaxMappingOrmEntity)
    private readonly taxRepo: Repository<TaxMappingOrmEntity>,
  ) {}

  /**
   * Tax stays category-based (internalTaxCategory -> one shared, approved
   * tax_mappings row — KRA only has 5 tax types) and still throws if
   * genuinely unresolvable (see resolveTaxTyCd). Classification/quantity/
   * packaging unit and product type are all supplied directly by the
   * caller now (Item Sync's Add/Edit/Bulk Edit, or a manual item's own
   * form) -- see ClassificationMethod's doc comment for why the old
   * classification_mappings-backed auto-match chain was removed. Missing
   * any of the four simply resolves to null, never throws.
   */
  async resolveClassification(params: {
    merchantId: string;
    classificationCode?: string;
    unitCode?: string;
    packagingUnitCode?: string;
    taxTyCd?: string;
    productTypeCode?: string;
    internalTaxCategory?: string;
  }): Promise<ClassificationResolution> {
    const merchantId = params.merchantId;

    // Never inferred/guessed -- null (unset) is a legitimate, expected value
    // here (see CatalogItem.productTypeCode's doc comment), not a gap to fill.
    const productTypeCode = params.productTypeCode ?? null;

    const taxTyCd =
      params.taxTyCd ??
      (await this.resolveTaxTyCd(merchantId, params.internalTaxCategory));

    // No category table or per-item lookup backs any of these three --
    // either the caller supplied its own value directly, or there's
    // nothing to resolve. null (not a throw) is the expected result of
    // "not yet set" -- see this class's top-level doc comment and
    // CatalogItem.needsClassificationMapping.
    const unitCode = params.unitCode ?? null;
    const packagingUnitCode = params.packagingUnitCode ?? null;
    const classificationCode = params.classificationCode ?? null;

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
      unitCode,
      packagingUnitCode,
      taxTyCd,
      productTypeCode,
      source,
      method: classificationCode ? 'EXPLICIT' : 'UNRESOLVED',
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
}
