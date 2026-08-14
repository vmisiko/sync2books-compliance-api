import { Injectable } from '@nestjs/common';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';
import type { ClassificationMatchType } from '../infrastructure/persistence/classification-mapping.orm-entity';

export interface TaxMappingSuggestion {
  internalTaxCategory: TaxCategory;
  taxTyCd: string;
  /** 0-100. Always in the 90-98 band per the confidence rules below — this service never emits a low-confidence guess. */
  confidenceScore: number;
}

export interface UnitMappingSuggestion {
  internalUnit: string;
  qtyUnitCd: string;
  pkgUnitCd: string;
  confidenceScore: number;
}

export interface ClassificationPlaceholder {
  matchType: ClassificationMatchType;
  matchValue: string;
}

/** Matches oscu-mapping.seed.ts's internalTaxCategory -> KRA taxTyCd convention (EXEMPT=A, VAT_STANDARD=B, VAT_ZERO=C, OTHER=D). */
const TAX_CATEGORY_CODE: Record<TaxCategory, string> = {
  [TaxCategory.EXEMPT]: 'A',
  [TaxCategory.VAT_STANDARD]: 'B',
  [TaxCategory.VAT_ZERO]: 'C',
  [TaxCategory.OTHER]: 'D',
};

/** Matches oscu-mapping.seed.ts's known internal units (EA/EACH/PCS -> NO, KG -> KG, L/LTR -> LTR). */
const KNOWN_UNITS: Array<{
  internalUnit: string;
  qtyUnitCd: string;
  pkgUnitCd: string;
  aliases: string[];
}> = [
  { internalUnit: 'EA', qtyUnitCd: 'NO', pkgUnitCd: 'NT', aliases: ['ea', 'each', 'pcs', 'pc', 'piece', 'pieces', 'unit', 'units', 'item', 'items'] },
  { internalUnit: 'KG', qtyUnitCd: 'KG', pkgUnitCd: 'NT', aliases: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos'] },
  { internalUnit: 'LTR', qtyUnitCd: 'LTR', pkgUnitCd: 'NT', aliases: ['l', 'ltr', 'litre', 'liter', 'litres', 'liters'] },
];

/**
 * Confidence-scored auto-suggestion for the Mapping Center dashboard.
 * Deliberately conservative: for tax and unit mapping it only ever emits a
 * suggestion when a heuristic actually fires (90-98% band), and for item
 * classification it doesn't attempt automatic matching against KRA's
 * multi-thousand-row classification tree at all — see
 * suggestClassificationPlaceholder. This is pure scoring logic (no DB
 * access); DashboardMappingApplicationService is responsible for turning a
 * suggestion into a persisted tax_mappings/unit_mappings/classification_mappings row.
 */
@Injectable()
export class MappingSuggestionService {
  /**
   * @param name Raw label as it appeared in the source system, e.g. "16% Standard VAT".
   * @param ratePercent The tax rate as a percentage (e.g. 16 for 16%), if known.
   */
  suggestTaxMapping(name: string, ratePercent: number | null): TaxMappingSuggestion | null {
    const n = (name ?? '').toLowerCase();

    if (n.includes('exempt')) {
      return {
        internalTaxCategory: TaxCategory.EXEMPT,
        taxTyCd: TAX_CATEGORY_CODE[TaxCategory.EXEMPT],
        confidenceScore: 95,
      };
    }

    const isZeroRate = ratePercent !== null && Math.abs(ratePercent) < 0.001;
    if (isZeroRate || n.includes('zero')) {
      const confidenceScore = isZeroRate && n.includes('zero') ? 98 : isZeroRate ? 92 : 90;
      return {
        internalTaxCategory: TaxCategory.VAT_ZERO,
        taxTyCd: TAX_CATEGORY_CODE[TaxCategory.VAT_ZERO],
        confidenceScore,
      };
    }

    const isStandardRate = ratePercent !== null && Math.abs(ratePercent - 16) <= 0.5;
    const mentionsStandard = n.includes('standard') || n.includes('vat');
    if (isStandardRate || mentionsStandard) {
      let confidenceScore = 90;
      if (isStandardRate && mentionsStandard) confidenceScore = 98;
      else if (isStandardRate) confidenceScore = 94;
      else if (n.includes('standard')) confidenceScore = 92;
      return {
        internalTaxCategory: TaxCategory.VAT_STANDARD,
        taxTyCd: TAX_CATEGORY_CODE[TaxCategory.VAT_STANDARD],
        confidenceScore,
      };
    }

    // Anything else — don't guess wildly. Caller reports this rate as unmapped.
    return null;
  }

  /** @param label Raw unit-of-measure label from the source system, e.g. MainApiItem.unitOfMeasure. */
  suggestUnitMapping(label: string | null | undefined): UnitMappingSuggestion | null {
    const n = (label ?? '').trim().toLowerCase();
    if (!n) return null;

    for (const u of KNOWN_UNITS) {
      if (u.aliases.includes(n)) {
        return { internalUnit: u.internalUnit, qtyUnitCd: u.qtyUnitCd, pkgUnitCd: u.pkgUnitCd, confidenceScore: 95 };
      }
    }
    // Looser contains-match (e.g. "Kilograms (kg)") — still confident enough to surface, lower score.
    for (const u of KNOWN_UNITS) {
      if (u.aliases.some((alias) => n.includes(alias))) {
        return { internalUnit: u.internalUnit, qtyUnitCd: u.qtyUnitCd, pkgUnitCd: u.pkgUnitCd, confidenceScore: 75 };
      }
    }
    return null;
  }

  /**
   * Deliberately NOT a classifier. KRA's itemClsCd tree has several thousand
   * rows (see OscuItemClassificationOrmEntity) and guessing at it is out of
   * scope for this pass — this just picks the best available match key so a
   * NEEDS_REVIEW row can be created for a human to fill in itemClsCd via
   * PATCH dashboard-api/mappings/:id. Mirrors the match-type precedence
   * ClassificationResolverTypeOrm itself uses (EXTERNAL_ID > SKU > NAME_CONTAINS).
   */
  suggestClassificationPlaceholder(input: {
    externalId?: string | null;
    sku?: string | null;
    itemName?: string | null;
  }): ClassificationPlaceholder | null {
    if (input.externalId) return { matchType: 'EXTERNAL_ID', matchValue: input.externalId };
    if (input.sku) return { matchType: 'SKU', matchValue: input.sku };
    if (input.itemName) return { matchType: 'NAME_CONTAINS', matchValue: input.itemName };
    return null;
  }
}
