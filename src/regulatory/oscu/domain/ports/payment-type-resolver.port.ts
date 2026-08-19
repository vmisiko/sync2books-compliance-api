/**
 * Resolves an internal payment-method key to KRA's OSCU pmtTyCd.
 * Uses payment_type_mappings — never hardcode a pmtTyCd at a call site.
 */
export interface IPaymentTypeResolver {
  /**
   * @param merchantId Tenant to resolve for (a merchant override, if approved, wins over
   *   the global default seeded by oscu-mapping.seed.ts).
   * @param internalPaymentMethod One of the 8 keys oscu-mapping.seed.ts seeds
   *   (CASH, CREDIT, CASH_CREDIT, BANK_CHECK, DEBIT_CREDIT, CARD, MOBILE_MONEY, OTHER).
   * @throws if no active mapping exists for this key at all (shouldn't happen for the
   *   8 seeded keys — the global tier always has one — but can for a caller-supplied
   *   key that isn't one of the 8).
   */
  resolve(merchantId: string, internalPaymentMethod: string): Promise<string>;
}
