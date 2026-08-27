import type { CatalogItem } from '../entities/catalog-item.entity';

export interface ICatalogItemRepository {
  save(item: CatalogItem): Promise<CatalogItem>;
  findById(id: string): Promise<CatalogItem | null>;
  findByIds(ids: string[]): Promise<CatalogItem[]>;
  findByMerchant(merchantId: string): Promise<CatalogItem[]>;
  /**
   * `sourceSystem`, when passed, scopes the match so two ERPs sharing the
   * same small numeric externalId for this merchant don't resolve to each
   * other's catalog row (see IClassificationResolver's doc comment for the
   * same reasoning). Omit only for pre-existing call sites that haven't
   * been updated to track their item's source yet -- new call sites should
   * always pass it when known.
   */
  findByMerchantAndExternalId(
    merchantId: string,
    externalId: string,
    sourceSystem?: string | null,
  ): Promise<CatalogItem | null>;
  /**
   * Exact, case-insensitive name match within a merchant's catalog. Used to
   * correlate a KRA-supplied purchase line's `itemNm` back to an item this
   * merchant has already registered under their own `itemCd` -- KRA's
   * `sendPurchaseTransactionInfo` requires the purchased item to exist in
   * the buyer's own item registry (see oscu-payload-gotchas.md), and there
   * is no other identifier connecting a supplier's line item to our catalog.
   * Deliberately exact rather than fuzzy: a wrong guess here would submit
   * incorrect data to KRA, which is worse than failing loudly and asking
   * the merchant to register the item first.
   */
  findByMerchantAndName(
    merchantId: string,
    name: string,
  ): Promise<CatalogItem | null>;
}
