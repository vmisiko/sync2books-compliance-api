import { TaxCategory } from '../../../shared/domain/enums/tax-category.enum';

/**
 * Line item on a compliance document.
 * Snapshot fields must be stored at time of creation - never mutated after VALIDATED.
 */
export interface ComplianceLine {
  id: string;
  documentId: string;
  itemId: string;
  /** eTIMS/OSCU item code (`itemCd`) snapshot used for submission. */
  etimsItemCodeSnapshot: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxCategory: TaxCategory;
  taxAmount: number;
  classificationCodeSnapshot: string;
  unitCodeSnapshot: string;
  packagingUnitCodeSnapshot: string | null;
  taxTyCdSnapshot: string | null;
  productTypeCodeSnapshot: string | null;
  createdAt: Date;
}
