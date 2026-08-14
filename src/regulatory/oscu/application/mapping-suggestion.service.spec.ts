import { MappingSuggestionService } from './mapping-suggestion.service';
import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

describe('MappingSuggestionService', () => {
  let service: MappingSuggestionService;

  beforeEach(() => {
    service = new MappingSuggestionService();
  });

  describe('suggestTaxMapping', () => {
    it('maps a rate literally named "16%" (standard rate, no keyword) to VAT_STANDARD with high confidence', () => {
      const result = service.suggestTaxMapping('16%', 16);
      expect(result).toEqual({
        internalTaxCategory: TaxCategory.VAT_STANDARD,
        taxTyCd: 'B',
        confidenceScore: 94,
      });
    });

    it('maps "16% Standard VAT" (rate + keyword both hit) to VAT_STANDARD at the top of the band', () => {
      const result = service.suggestTaxMapping('16% Standard VAT', 16);
      expect(result?.internalTaxCategory).toBe(TaxCategory.VAT_STANDARD);
      expect(result?.taxTyCd).toBe('B');
      expect(result?.confidenceScore).toBe(98);
    });

    it('maps a name containing "exempt" to EXEMPT regardless of rate', () => {
      const result = service.suggestTaxMapping('Exempt Sales', null);
      expect(result).toEqual({
        internalTaxCategory: TaxCategory.EXEMPT,
        taxTyCd: 'A',
        confidenceScore: 95,
      });
    });

    it('maps a 0% rate to VAT_ZERO', () => {
      const result = service.suggestTaxMapping('Zero Rated', 0);
      expect(result?.internalTaxCategory).toBe(TaxCategory.VAT_ZERO);
      expect(result?.taxTyCd).toBe('C');
      expect(result?.confidenceScore).toBe(98);
    });

    it('maps an unrecognized rate/name to no suggestion (caller reports Unmapped)', () => {
      const result = service.suggestTaxMapping('Custom Rate XYZ', 7.5);
      expect(result).toBeNull();
    });

    it('returns null for an empty/undefined name with no rate', () => {
      expect(service.suggestTaxMapping('', null)).toBeNull();
    });
  });

  describe('suggestUnitMapping', () => {
    it('matches an exact alias with high confidence', () => {
      const result = service.suggestUnitMapping('kg');
      expect(result).toEqual({
        internalUnit: 'KG',
        qtyUnitCd: 'KG',
        pkgUnitCd: 'NT',
        confidenceScore: 95,
      });
    });

    it('matches a looser contains-style label at lower confidence', () => {
      const result = service.suggestUnitMapping('Kilograms (kg)');
      expect(result?.internalUnit).toBe('KG');
      expect(result?.confidenceScore).toBe(75);
    });

    it('is case-insensitive and trims whitespace for exact alias matches', () => {
      const result = service.suggestUnitMapping('  EACH  ');
      expect(result?.internalUnit).toBe('EA');
      expect(result?.confidenceScore).toBe(95);
    });

    it('returns null for an unrecognized unit label', () => {
      expect(service.suggestUnitMapping('gigawatt')).toBeNull();
    });

    it('returns null for empty/null/undefined input', () => {
      expect(service.suggestUnitMapping('')).toBeNull();
      expect(service.suggestUnitMapping(null)).toBeNull();
      expect(service.suggestUnitMapping(undefined)).toBeNull();
    });
  });

  describe('suggestClassificationPlaceholder', () => {
    it('prefers EXTERNAL_ID over SKU and item name', () => {
      const result = service.suggestClassificationPlaceholder({
        externalId: 'ext-1',
        sku: 'sku-1',
        itemName: 'Widget',
      });
      expect(result).toEqual({ matchType: 'EXTERNAL_ID', matchValue: 'ext-1' });
    });

    it('falls back to SKU when no externalId is present', () => {
      const result = service.suggestClassificationPlaceholder({
        sku: 'sku-1',
        itemName: 'Widget',
      });
      expect(result).toEqual({ matchType: 'SKU', matchValue: 'sku-1' });
    });

    it('falls back to NAME_CONTAINS when neither externalId nor sku is present', () => {
      const result = service.suggestClassificationPlaceholder({
        itemName: 'Widget',
      });
      expect(result).toEqual({
        matchType: 'NAME_CONTAINS',
        matchValue: 'Widget',
      });
    });

    it('returns null when nothing usable is provided', () => {
      expect(service.suggestClassificationPlaceholder({})).toBeNull();
    });
  });
});
