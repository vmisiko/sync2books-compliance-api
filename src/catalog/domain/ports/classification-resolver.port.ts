/**
 * Resolves internal attributes to regulator codes.
 * Uses mapping tables - never hardcode OSCU codes.
 */
export interface ClassificationResolution {
  classificationCode: string;
  unitCode: string;
  source: 'merchant_override' | 'rule_based' | 'default';
}

export interface IClassificationResolver {
  resolveClassification(params: {
    merchantId: string;
    itemType: string;
    itemName?: string;
    sku?: string;
  }): Promise<ClassificationResolution>;
}
