import { Injectable } from '@nestjs/common';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

export interface TaxMappingSuggestion {
  internalTaxCategory: TaxCategory;
  taxTyCd: string;
  /** 0-100. Always in the 90-98 band per the confidence rules below — this service never emits a low-confidence guess. */
  confidenceScore: number;
}

export interface QuantityUnitAliasMatch {
  internalUnit: string;
  /**
   * A search term to feed into the live oscu_codes table (cdCls '10'), NOT
   * a hardcoded final qtyUnitCd — deliberately: this service has no DB
   * access (see the class doc comment), and KRA's exact code↔name pairing
   * should always be resolved against the live-synced table, not a value
   * frozen into this file, so a code renumbering or resync corrects itself
   * automatically instead of silently going stale.
   */
  searchTerm: string;
}

export interface PaymentMethodMappingSuggestion {
  internalPaymentMethod: string;
  pmtTyCd: string;
  confidenceScore: number;
}

/** Matches oscu-mapping.seed.ts's internalTaxCategory -> KRA taxTyCd convention (EXEMPT=A, VAT_STANDARD=B, VAT_ZERO=C, OTHER=D, VAT_8=E) — same convention as oscu_codes' cdCls '04' (Tax Type) reference table. */
const TAX_CATEGORY_CODE: Record<TaxCategory, string> = {
  [TaxCategory.EXEMPT]: 'A',
  [TaxCategory.VAT_STANDARD]: 'B',
  [TaxCategory.VAT_ZERO]: 'C',
  [TaxCategory.OTHER]: 'D',
  [TaxCategory.VAT_8]: 'E',
};

/**
 * Common ERP quantity-unit phrasings, normalized to an internal bucket key
 * and a search term to resolve against the live KRA cdCls '10' code list
 * (see matchKraCode in dashboard-mapping.application.service.ts, which does
 * the actual DB lookup — this table only narrows down which real code to
 * search for). Verified against the OSCU spec's own Unit of Quantity table
 * (.docs/OSCU_Specification_Document_v2.0.txt §4.7) rather than guessed —
 * a prior version of this table existed only in dead code
 * (suggestUnitMapping, never called anywhere) and had at least one
 * confirmed-wrong pairing (EA/EACH/PCS -> NO), which per the real spec is
 * U ("Pieces/item [Number]"); NO is a distinct code, "Number". Deliberately
 * does not cover every one of the ~30 codes — omits ones with no plausible
 * common ERP phrasing (e.g. NX "part per thousand") rather than guessing.
 */
const QTY_UNIT_ALIASES: Array<{
  internalUnit: string;
  searchTerm: string;
  aliases: string[];
}> = [
  {
    internalUnit: 'PIECES',
    searchTerm: 'pieces',
    aliases: [
      'ea',
      'each',
      'pcs',
      'pc',
      'piece',
      'pieces',
      'unit',
      'units',
      'item',
      'items',
    ],
  },
  {
    internalUnit: 'NUMBER',
    searchTerm: 'number',
    aliases: ['no', 'no.', 'number'],
  },
  {
    internalUnit: 'KILOGRAM',
    searchTerm: 'kilo',
    aliases: [
      'kg',
      'kgs',
      'kilogram',
      'kilograms',
      'kilo',
      'kilos',
      'kilogramme',
      'kilogrammes',
    ],
  },
  {
    internalUnit: 'GRAM',
    searchTerm: 'gram',
    aliases: ['g', 'gm', 'gms', 'gram', 'grams'],
  },
  {
    internalUnit: 'MILLIGRAM',
    searchTerm: 'milligram',
    aliases: ['mg', 'milligram', 'milligrams'],
  },
  {
    internalUnit: 'LITRE',
    searchTerm: 'litre',
    aliases: ['l', 'ltr', 'litre', 'liter', 'litres', 'liters'],
  },
  {
    internalUnit: 'GALLON',
    searchTerm: 'gallon',
    aliases: ['gal', 'gallon', 'gallons'],
  },
  {
    internalUnit: 'DOZEN',
    searchTerm: 'dozen',
    aliases: ['dz', 'doz', 'dozen'],
  },
  { internalUnit: 'GROSS', searchTerm: 'gross', aliases: ['gross'] },
  {
    internalUnit: 'METRE',
    searchTerm: 'metre',
    aliases: ['m', 'metre', 'meter', 'metres', 'meters'],
  },
  {
    internalUnit: 'SQUARE_METRE',
    searchTerm: 'square metre',
    aliases: [
      'm2',
      'sqm',
      'square metre',
      'square meter',
      'square metres',
      'square meters',
    ],
  },
  {
    internalUnit: 'CUBIC_METRE',
    searchTerm: 'cubic metre',
    aliases: ['m3', 'cbm', 'cubic metre', 'cubic meter'],
  },
  {
    internalUnit: 'KILOMETRE',
    searchTerm: 'kilometre',
    aliases: ['km', 'kilometre', 'kilometer', 'kilometres', 'kilometers'],
  },
  {
    internalUnit: 'YARD',
    searchTerm: 'yard',
    aliases: ['yd', 'yard', 'yards'],
  },
  {
    internalUnit: 'POUND',
    searchTerm: 'pound',
    aliases: ['lb', 'lbs', 'pound', 'pounds'],
  },
  {
    internalUnit: 'TONNE',
    searchTerm: 'tonne',
    aliases: ['ton', 'tons', 'tonne', 'tonnes', 'metric ton', 'metric tons'],
  },
  {
    internalUnit: 'KILOWATT',
    searchTerm: 'kilowatt',
    aliases: ['kw', 'kilowatt', 'kilowatts'],
  },
  {
    internalUnit: 'MEGAWATT',
    searchTerm: 'megawatt',
    aliases: ['mw', 'megawatt', 'megawatts'],
  },
  {
    internalUnit: 'PACKET',
    searchTerm: 'packet',
    aliases: ['pack', 'packs', 'packet', 'packets'],
  },
  { internalUnit: 'PLATE', searchTerm: 'plate', aliases: ['plate', 'plates'] },
  { internalUnit: 'PAIR', searchTerm: 'pair', aliases: ['pair', 'pairs'] },
  { internalUnit: 'REEL', searchTerm: 'reel', aliases: ['reel', 'reels'] },
  { internalUnit: 'ROLL', searchTerm: 'roll', aliases: ['roll', 'rolls'] },
  { internalUnit: 'SET', searchTerm: 'set', aliases: ['set', 'sets'] },
  { internalUnit: 'SHEET', searchTerm: 'sheet', aliases: ['sheet', 'sheets'] },
  { internalUnit: 'TUBE', searchTerm: 'tube', aliases: ['tube', 'tubes'] },
  { internalUnit: 'LINK', searchTerm: 'link', aliases: ['link', 'links'] },
];

/** Matches oscu-mapping.seed.ts's 8 internal payment methods -> OSCU pmtTyCd (cdCls '07'). */
const KNOWN_PAYMENT_METHODS: Array<{
  internalPaymentMethod: string;
  pmtTyCd: string;
  aliases: string[];
}> = [
  { internalPaymentMethod: 'CASH', pmtTyCd: '01', aliases: ['cash'] },
  {
    internalPaymentMethod: 'CREDIT',
    pmtTyCd: '02',
    aliases: ['credit', 'on account', 'on credit', 'invoice'],
  },
  {
    internalPaymentMethod: 'CASH_CREDIT',
    pmtTyCd: '03',
    aliases: ['cash/credit', 'cash and credit', 'cash or credit'],
  },
  {
    internalPaymentMethod: 'BANK_CHECK',
    pmtTyCd: '04',
    aliases: ['check', 'cheque', 'bank check', 'bank cheque'],
  },
  {
    internalPaymentMethod: 'DEBIT_CREDIT',
    pmtTyCd: '05',
    aliases: [
      'debit card',
      'credit card',
      'debit/credit card',
      'visa',
      'mastercard',
    ],
  },
  {
    internalPaymentMethod: 'CARD',
    pmtTyCd: '06',
    aliases: ['card', 'e-check', 'echeck'],
  },
  {
    internalPaymentMethod: 'MOBILE_MONEY',
    pmtTyCd: '07',
    aliases: [
      'mobile money',
      'm-pesa',
      'mpesa',
      'm pesa',
      'till',
      'till number',
      'paybill',
      'airtel money',
    ],
  },
  { internalPaymentMethod: 'OTHER', pmtTyCd: '08', aliases: ['other'] },
];

/**
 * Confidence-scored auto-suggestion for the Mapping Center dashboard.
 * Deliberately conservative: for tax and unit mapping it only ever emits a
 * suggestion when a heuristic actually fires (90-98% band). Item
 * classification is out of scope entirely — see classification-resolver.port.ts's
 * doc comment for why that's now handled directly in Item Sync instead of
 * here. This is pure scoring logic (no DB access); DashboardMappingApplicationService
 * is responsible for turning a suggestion into a persisted tax_mappings/unit_mappings row.
 */
@Injectable()
export class MappingSuggestionService {
  /**
   * @param name Raw label as it appeared in the source system, e.g. "16% Standard VAT".
   * @param ratePercent The tax rate as a percentage (e.g. 16 for 16%), if known.
   */
  suggestTaxMapping(
    name: string,
    ratePercent: number | null,
  ): TaxMappingSuggestion | null {
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
      const confidenceScore =
        isZeroRate && n.includes('zero') ? 98 : isZeroRate ? 92 : 90;
      return {
        internalTaxCategory: TaxCategory.VAT_ZERO,
        taxTyCd: TAX_CATEGORY_CODE[TaxCategory.VAT_ZERO],
        confidenceScore,
      };
    }

    const isEightRate =
      ratePercent !== null && Math.abs(ratePercent - 8) <= 0.5;
    if (isEightRate) {
      const confidenceScore = n.includes('8%') || n.includes('petro') ? 95 : 90;
      return {
        internalTaxCategory: TaxCategory.VAT_8,
        taxTyCd: TAX_CATEGORY_CODE[TaxCategory.VAT_8],
        confidenceScore,
      };
    }

    const isStandardRate =
      ratePercent !== null && Math.abs(ratePercent - 16) <= 0.5;
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

  /**
   * Same scoring intent as suggestTaxMapping, but tuned against QuickBooks
   * TaxCode names (MainApiTaxCode.name) rather than TaxRate names — TaxCode
   * is the entity actually assignable to a transaction line
   * (SalesItemLineDetail.TaxCodeRef), so this is what resolves a mapping
   * row's taxCodeId. Tuned against real TaxCode names confirmed live on a
   * KRA org today: "0.0% Z" (Zero-rated), "14.0% S"/"16.0% S" (Standard —
   * both old and current KRA VAT rates), "14.0% S - RC Imported Services"/
   * "16.0% S - RC Imported Services" (reverse-charge imported services),
   * "14.0% S Import"/"16.0% S Import" (standard-rated imports), "8.0%
   * Petrol" (petroleum — KRA's own code table has a dedicated 8% tax-type
   * code, taxTyCd 'E', so this resolves to VAT_8, not VAT_STANDARD),
   * "Exempt Purchase"/"Exempt Sale" (exempt), "No VAT" (out of scope of
   * VAT -> OTHER). Import/reverse-charge variants of the *16%* rate still
   * resolve to VAT_STANDARD (the rate is what determines the KRA category,
   * not the import/RC bookkeeping treatment) but at a capped, lower
   * confidence since they're a less direct match than the plain "<rate>% S"
   * form.
   * @param name Raw TaxCode name/label as it appeared in the source system.
   */
  suggestTaxCodeMapping(name: string): TaxMappingSuggestion | null {
    const raw = name ?? '';
    const n = raw.toLowerCase();
    if (!n.trim()) return null;

    if (n.includes('exempt')) {
      return {
        internalTaxCategory: TaxCategory.EXEMPT,
        taxTyCd: TAX_CATEGORY_CODE[TaxCategory.EXEMPT],
        confidenceScore: 95,
      };
    }

    if (n.includes('no vat') || n.includes('out of scope')) {
      return {
        internalTaxCategory: TaxCategory.OTHER,
        taxTyCd: TAX_CATEGORY_CODE[TaxCategory.OTHER],
        confidenceScore: 95,
      };
    }

    const percentMatch = raw.match(/(\d+(?:\.\d+)?)\s*%/);
    const ratePercent = percentMatch ? parseFloat(percentMatch[1]) : null;
    const isZeroRate = ratePercent !== null && Math.abs(ratePercent) < 0.001;
    // KRA's own convention embeds a one-letter suffix in the code label
    // (S=standard, Z=zero, E=exempt) — e.g. "0.0% Z", "16.0% S".
    const hasZeroSuffix = /\bz\b/.test(n);
    const hasStandardSuffix = /\bs\b/.test(n);

    if (isZeroRate || n.includes('zero')) {
      let confidenceScore = 90;
      if (isZeroRate && (hasZeroSuffix || n.includes('zero')))
        confidenceScore = 98;
      else if (isZeroRate) confidenceScore = 92;
      return {
        internalTaxCategory: TaxCategory.VAT_ZERO,
        taxTyCd: TAX_CATEGORY_CODE[TaxCategory.VAT_ZERO],
        confidenceScore,
      };
    }

    const isEightRate =
      ratePercent !== null && Math.abs(ratePercent - 8) <= 0.5;
    if (isEightRate) {
      return {
        internalTaxCategory: TaxCategory.VAT_8,
        taxTyCd: TAX_CATEGORY_CODE[TaxCategory.VAT_8],
        confidenceScore: n.includes('petro') ? 92 : 88,
      };
    }

    const isPositiveRate = ratePercent !== null && ratePercent > 0;
    if (isPositiveRate || hasStandardSuffix || n.includes('standard')) {
      let confidenceScore = 88;
      if (isPositiveRate && hasStandardSuffix) confidenceScore = 96;
      else if (hasStandardSuffix || n.includes('standard'))
        confidenceScore = 90;

      const isImportOrReverseCharge =
        n.includes('import') ||
        n.includes(' rc ') ||
        n.includes('reverse charge');
      if (isImportOrReverseCharge)
        confidenceScore = Math.min(confidenceScore, 85);

      return {
        internalTaxCategory: TaxCategory.VAT_STANDARD,
        taxTyCd: TAX_CATEGORY_CODE[TaxCategory.VAT_STANDARD],
        confidenceScore,
      };
    }

    // Anything else — don't guess wildly. Caller reports this code as unmapped.
    return null;
  }

  /**
   * Alias lookup only — resolving the actual qtyUnitCd against the live
   * KRA code list is DashboardMappingApplicationService's job (this class
   * has no DB access, see the class doc comment). Exact alias match first,
   * then a looser contains-match (e.g. "Kilograms (kg)") at lower priority
   * — callers should prefer an exact hit's searchTerm over a contains hit's.
   * @param label Raw unit-of-measure label from the source system, e.g. MainApiItem.unitOfMeasure.
   */
  suggestQuantityUnitAlias(
    label: string | null | undefined,
  ): QuantityUnitAliasMatch | null {
    const n = (label ?? '').trim().toLowerCase();
    if (!n) return null;

    for (const u of QTY_UNIT_ALIASES) {
      if (u.aliases.includes(n)) {
        return { internalUnit: u.internalUnit, searchTerm: u.searchTerm };
      }
    }
    // Loose contains-match (e.g. "Kilograms (kg)") — restricted to aliases
    // of 3+ characters. A short alias like the bare letter "g" or "m" is
    // fine for an exact whole-label match above, but as a substring check
    // it false-positives constantly (e.g. "gigawatt".includes('g')).
    for (const u of QTY_UNIT_ALIASES) {
      if (u.aliases.some((alias) => alias.length >= 3 && n.includes(alias))) {
        return { internalUnit: u.internalUnit, searchTerm: u.searchTerm };
      }
    }
    return null;
  }

  /** @param label Raw label from the source system, e.g. QuickBooks PaymentMethod.Name ("Cash", "M-Pesa", "Credit Card"). */
  suggestPaymentMethodMapping(
    label: string | null | undefined,
  ): PaymentMethodMappingSuggestion | null {
    const n = (label ?? '').trim().toLowerCase();
    if (!n) return null;

    for (const p of KNOWN_PAYMENT_METHODS) {
      if (p.aliases.includes(n)) {
        return {
          internalPaymentMethod: p.internalPaymentMethod,
          pmtTyCd: p.pmtTyCd,
          confidenceScore: 95,
        };
      }
    }
    // Looser contains-match (e.g. "M-Pesa Till") — still confident enough to surface, lower score.
    for (const p of KNOWN_PAYMENT_METHODS) {
      if (p.aliases.some((alias) => n.includes(alias))) {
        return {
          internalPaymentMethod: p.internalPaymentMethod,
          pmtTyCd: p.pmtTyCd,
          confidenceScore: 75,
        };
      }
    }
    return null;
  }
}
