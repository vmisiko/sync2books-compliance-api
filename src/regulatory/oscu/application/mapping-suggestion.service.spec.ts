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

    it('maps an 8% rate to VAT_8 (KRA taxTyCd E), not VAT_STANDARD', () => {
      const result = service.suggestTaxMapping('PPetro-8', 8);
      expect(result?.internalTaxCategory).toBe(TaxCategory.VAT_8);
      expect(result?.taxTyCd).toBe('E');
      expect(result?.confidenceScore).toBeGreaterThanOrEqual(90);
    });

    it('maps an unrecognized rate/name to no suggestion (caller reports Unmapped)', () => {
      const result = service.suggestTaxMapping('Custom Rate XYZ', 21.5);
      expect(result).toBeNull();
    });

    it('returns null for an empty/undefined name with no rate', () => {
      expect(service.suggestTaxMapping('', null)).toBeNull();
    });
  });

  describe('suggestTaxCodeMapping', () => {
    // Tuned against real TaxCode names confirmed live against a KRA org
    // today (see MappingSuggestionService.suggestTaxCodeMapping's doc
    // comment).
    it('maps "16.0% S" (current standard rate + S suffix) to VAT_STANDARD at the top of the band', () => {
      const result = service.suggestTaxCodeMapping('16.0% S');
      expect(result).toEqual({
        internalTaxCategory: TaxCategory.VAT_STANDARD,
        taxTyCd: 'B',
        confidenceScore: 96,
      });
    });

    it('maps "14.0% S" (old standard rate + S suffix) to VAT_STANDARD too', () => {
      const result = service.suggestTaxCodeMapping('14.0% S');
      expect(result?.internalTaxCategory).toBe(TaxCategory.VAT_STANDARD);
      expect(result?.taxTyCd).toBe('B');
      expect(result?.confidenceScore).toBe(96);
    });

    it('maps "16.0% S Import" to VAT_STANDARD at a capped, lower confidence than the plain form', () => {
      const result = service.suggestTaxCodeMapping('16.0% S Import');
      expect(result?.internalTaxCategory).toBe(TaxCategory.VAT_STANDARD);
      expect(result?.confidenceScore).toBeLessThanOrEqual(85);
      const plain = service.suggestTaxCodeMapping('16.0% S');
      expect(result!.confidenceScore).toBeLessThan(plain!.confidenceScore);
    });

    it('maps "16.0% S - RC Imported Services" to VAT_STANDARD at a capped, lower confidence', () => {
      const result = service.suggestTaxCodeMapping(
        '16.0% S - RC Imported Services',
      );
      expect(result?.internalTaxCategory).toBe(TaxCategory.VAT_STANDARD);
      expect(result?.confidenceScore).toBeLessThanOrEqual(85);
    });

    it('maps "8.0% Petrol" to VAT_8 (KRA taxTyCd E), not VAT_STANDARD', () => {
      const result = service.suggestTaxCodeMapping('8.0% Petrol');
      expect(result?.internalTaxCategory).toBe(TaxCategory.VAT_8);
      expect(result?.taxTyCd).toBe('E');
    });

    it('maps "0.0% Z" to VAT_ZERO at the top of the band', () => {
      const result = service.suggestTaxCodeMapping('0.0% Z');
      expect(result).toEqual({
        internalTaxCategory: TaxCategory.VAT_ZERO,
        taxTyCd: 'C',
        confidenceScore: 98,
      });
    });

    it('maps "Exempt Sale" and "Exempt Purchase" to EXEMPT', () => {
      expect(service.suggestTaxCodeMapping('Exempt Sale')).toEqual({
        internalTaxCategory: TaxCategory.EXEMPT,
        taxTyCd: 'A',
        confidenceScore: 95,
      });
      expect(service.suggestTaxCodeMapping('Exempt Purchase')).toEqual({
        internalTaxCategory: TaxCategory.EXEMPT,
        taxTyCd: 'A',
        confidenceScore: 95,
      });
    });

    it('maps "No VAT" to OTHER (out of scope of VAT)', () => {
      const result = service.suggestTaxCodeMapping('No VAT');
      expect(result).toEqual({
        internalTaxCategory: TaxCategory.OTHER,
        taxTyCd: 'D',
        confidenceScore: 95,
      });
    });

    it('maps an unrecognized name to no suggestion', () => {
      expect(service.suggestTaxCodeMapping('Custom Weird Code')).toBeNull();
    });

    it('returns null for an empty/undefined name', () => {
      expect(service.suggestTaxCodeMapping('')).toBeNull();
      expect(
        service.suggestTaxCodeMapping(undefined as unknown as string),
      ).toBeNull();
    });
  });

  describe('suggestQuantityUnitAlias', () => {
    it('matches an exact alias', () => {
      const result = service.suggestQuantityUnitAlias('kg');
      expect(result).toEqual({ internalUnit: 'KILOGRAM', searchTerm: 'kilo' });
    });

    it('matches a looser contains-style label', () => {
      const result = service.suggestQuantityUnitAlias('Kilograms (kg)');
      expect(result?.internalUnit).toBe('KILOGRAM');
    });

    it('is case-insensitive and trims whitespace for exact alias matches', () => {
      const result = service.suggestQuantityUnitAlias('  EACH  ');
      expect(result?.internalUnit).toBe('PIECES');
    });

    it('resolves "each"/"pcs"/"piece" to PIECES (U), not NUMBER (NO) — these are distinct KRA codes per the OSCU spec', () => {
      expect(service.suggestQuantityUnitAlias('each')?.internalUnit).toBe(
        'PIECES',
      );
      expect(service.suggestQuantityUnitAlias('pcs')?.internalUnit).toBe(
        'PIECES',
      );
      expect(service.suggestQuantityUnitAlias('number')?.internalUnit).toBe(
        'NUMBER',
      );
    });

    it('returns null for an unrecognized unit label', () => {
      expect(service.suggestQuantityUnitAlias('gigawatt')).toBeNull();
    });

    it('returns null for empty/null/undefined input', () => {
      expect(service.suggestQuantityUnitAlias('')).toBeNull();
      expect(service.suggestQuantityUnitAlias(null)).toBeNull();
      expect(service.suggestQuantityUnitAlias(undefined)).toBeNull();
    });
  });

  describe('suggestPaymentMethodMapping', () => {
    it('matches an exact alias with high confidence', () => {
      expect(service.suggestPaymentMethodMapping('Cash')).toEqual({
        internalPaymentMethod: 'CASH',
        pmtTyCd: '01',
        confidenceScore: 95,
      });
      expect(service.suggestPaymentMethodMapping('m-pesa')).toEqual({
        internalPaymentMethod: 'MOBILE_MONEY',
        pmtTyCd: '07',
        confidenceScore: 95,
      });
      expect(service.suggestPaymentMethodMapping('Credit Card')).toEqual({
        internalPaymentMethod: 'DEBIT_CREDIT',
        pmtTyCd: '05',
        confidenceScore: 95,
      });
    });

    it('falls back to a lower-confidence substring match', () => {
      expect(service.suggestPaymentMethodMapping('M-Pesa Till')).toEqual({
        internalPaymentMethod: 'MOBILE_MONEY',
        pmtTyCd: '07',
        confidenceScore: 75,
      });
    });

    it('returns null for an unrecognized label', () => {
      expect(
        service.suggestPaymentMethodMapping('Store Loyalty Points'),
      ).toBeNull();
    });

    it('returns null for empty/null/undefined input', () => {
      expect(service.suggestPaymentMethodMapping('')).toBeNull();
      expect(service.suggestPaymentMethodMapping(null)).toBeNull();
      expect(service.suggestPaymentMethodMapping(undefined)).toBeNull();
    });
  });
});
