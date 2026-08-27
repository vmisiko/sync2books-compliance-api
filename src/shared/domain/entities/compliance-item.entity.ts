import { ItemType } from '../enums/item-type.enum';
import { TaxCategory } from '../enums/tax-category.enum';

/**
 * Compliance item - registered goods/services.
 * Versioning is critical for audit (lines snapshot at creation time).
 *
 * `CatalogItemTypeOrmRepository` implements both `ICatalogItemRepository`
 * and `IComplianceItemRepository` off the same `findByIds`, so this shape
 * must stay structurally compatible with `CatalogItem`
 * (catalog/domain/entities/catalog-item.entity.ts) -- in particular,
 * productTypeCode's nullability and the absence of `itemType` must match.
 */
export interface ComplianceItem {
  id: string;
  merchantId: string;
  name: string;
  sku: string | null;
  taxCategory: TaxCategory;
  classificationCode: string;
  /** OSCU unit of quantity code (qtyUnitCd) */
  unitCode: string;
  /** OSCU packaging unit code (pkgUnitCd) */
  packagingUnitCode: string;
  /** OSCU tax type code (taxTyCd) */
  taxTyCd: string;
  /**
   * OSCU product type code (itemTyCd). Null means nobody has chosen one yet
   * -- see CatalogItem.productTypeCode's doc comment. In practice a line
   * referencing an item this way should already be REGISTERED (and so
   * already have one), but callers must still handle null rather than
   * assume it's always set.
   */
  productTypeCode: string | null;
  /** eTIMS/OSCU item code (`itemCd`) used for submissions. */
  etimsItemCode?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Mirrors CatalogItem's deriveItemType -- see that function's doc comment for why this exists as its own derivation rather than a stored field. */
export function deriveItemType(
  productTypeCode: string | null,
): ItemType | null {
  if (productTypeCode === null) return null;
  return productTypeCode === '3' ? ItemType.SERVICE : ItemType.GOODS;
}
