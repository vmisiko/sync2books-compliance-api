import { DashboardItemsApplicationService } from './dashboard-items.application.service';
import type { CatalogService } from '../../catalog/api/catalog.service';
import type { CatalogItem } from '../../catalog/domain/entities/catalog-item.entity';
import type { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import type { InventoryService } from '../../inventory/api/inventory.service';
import type { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import type { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import type { MappingSuggestionService } from '../../regulatory/oscu/application/mapping-suggestion.service';
import { TaxCategory } from '../../shared/domain/enums/tax-category.enum';

const TENANT_ID = 'tenant-1';
const MERCHANT_ID = 'merchant-1';

function catalogItem(overrides: Partial<CatalogItem>): CatalogItem {
  return {
    id: 'item-x',
    merchantId: MERCHANT_ID,
    externalId: null,
    name: 'Jet A-1 Fuel',
    sku: null,
    taxCategory: TaxCategory.VAT_STANDARD,
    taxTyCd: 'B',
    classificationCode: '15101500',
    unitCode: 'U',
    packagingUnitCode: 'NT',
    productTypeCode: '2',
    unitPrice: 100,
    originCountry: 'KE',
    sourceSystem: null,
    registrationStatus: 'PENDING',
    etimsItemCode: null,
    deletedAt: null,
    version: 1,
    ...overrides,
  } as CatalogItem;
}

function makeService(items: CatalogItem[]) {
  const catalog = {
    getItemById: jest.fn((id: string) =>
      Promise.resolve(items.find((i) => i.id === id) ?? null),
    ),
    registerItem: jest.fn((params: Record<string, unknown>) =>
      Promise.resolve({ item: { ...params }, created: false }),
    ),
    updateManualItem: jest.fn((params: Record<string, unknown>) =>
      Promise.resolve({ ...params }),
    ),
  };

  const service = new DashboardItemsApplicationService(
    catalog as unknown as CatalogService,
    {
      resolveDashboardBranchId: jest.fn().mockResolvedValue('branch-1'),
    } as unknown as ComplianceOrganizationApplicationService,
    {
      resolveMerchantId: jest.fn().mockResolvedValue(MERCHANT_ID),
    } as unknown as MainApiConnectionApplicationService,
    {} as unknown as MainApiPullClient,
    {
      suggestTaxCodeMapping: jest.fn().mockReturnValue(null),
    } as unknown as MappingSuggestionService,
    {} as unknown as InventoryService,
  );
  return { service, catalog };
}

/**
 * The reported bug: editing an ERP-sourced item's Tax Code in Item Sync
 * returned 200 ("Item updated") with the tax unchanged, because this branch
 * rebuilt the registerItem call from `existing` and never passed the caller's
 * taxTyCd at all. taxTyCd is not an ERP field -- no ERP stores a KRA tax type
 * -- so a human's pick here is the only real source for it.
 */
describe('DashboardItemsApplicationService.updateItem -- taxTyCd', () => {
  const ERP_ITEM = catalogItem({
    id: 'item-qb-54',
    externalId: '54',
    sourceSystem: 'QUICKBOOKS',
  });

  it('applies a taxTyCd edit to an ERP-sourced item', async () => {
    const { service, catalog } = makeService([ERP_ITEM]);

    await service.updateItem(TENANT_ID, 'item-qb-54', { taxTyCd: 'E' });

    expect(catalog.registerItem).toHaveBeenCalledWith(
      expect.objectContaining({ taxTyCd: 'E' }),
    );
  });

  /**
   * taxTyCd alone would not survive: a pull re-resolves the code from
   * internalTaxCategory against tax_mappings, so leaving the category at
   * VAT_STANDARD would put the item straight back on 'B'.
   */
  it('writes the matching internalTaxCategory alongside it', async () => {
    const { service, catalog } = makeService([ERP_ITEM]);

    await service.updateItem(TENANT_ID, 'item-qb-54', { taxTyCd: 'E' });

    expect(catalog.registerItem).toHaveBeenCalledWith(
      expect.objectContaining({ taxCategory: TaxCategory.VAT_8 }),
    );
  });

  it('leaves tax alone on an unrelated edit, rather than re-deriving it', async () => {
    const { service, catalog } = makeService([
      { ...ERP_ITEM, taxTyCd: 'E', taxCategory: TaxCategory.VAT_8 },
    ]);

    await service.updateItem(TENANT_ID, 'item-qb-54', {
      packagingUnitCode: 'BE',
    });

    expect(catalog.registerItem).toHaveBeenCalledWith(
      expect.objectContaining({
        taxTyCd: 'E',
        taxCategory: TaxCategory.VAT_8,
        packagingUnitCode: 'BE',
      }),
    );
  });

  it('applies a taxTyCd edit to a manual item too', async () => {
    const { service, catalog } = makeService([catalogItem({ id: 'item-man' })]);

    await service.updateItem(TENANT_ID, 'item-man', { taxTyCd: 'E' });

    expect(catalog.updateManualItem).toHaveBeenCalledWith(
      expect.objectContaining({
        taxTyCd: 'E',
        taxCategory: TaxCategory.VAT_8,
      }),
    );
  });
});
