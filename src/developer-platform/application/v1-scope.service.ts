import { Injectable, NotFoundException } from '@nestjs/common';
import { CatalogService } from '../../catalog/api/catalog.service';
import type { CatalogItem } from '../../catalog/domain/entities/catalog-item.entity';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import type { ComplianceBranch } from '../../compliance-organization/domain/entities/compliance-branch.entity';
import { SalesService } from '../../sales/application/sales.service';
import type { ComplianceDocument } from '../../sales/domain/entities/compliance-document.entity';

/**
 * Turns "a business TenantScopeGuard allowed" into "the branches, items and
 * sales that business actually owns".
 *
 * TenantScopeGuard binds a request to one business, but most `/v1` routes
 * also carry ids of their own -- an item, a branch, a sale -- and the routes
 * underneath (`createDocument`, stock adjust, sale-by-id) trust those ids:
 * `createDocument` never compares an item's merchant to the document's, and
 * stock adjustment takes an item and a branch and no taxpayer at all. Those
 * were fine behind the internal service token, which is one trusted caller; on
 * a public API they would let a valid key for business A sell, restock or read
 * business B's records by naming B's ids. So every id a `/v1` route accepts is
 * resolved through here first, against the business the guard already bound.
 *
 * A foreign or unknown id is always a 404, never a 403: whether an id exists
 * in someone else's account is not something a caller gets to learn.
 */
@Injectable()
export class V1ScopeService {
  constructor(
    private readonly organizations: ComplianceOrganizationApplicationService,
    private readonly catalog: CatalogService,
    private readonly sales: SalesService,
  ) {}

  /**
   * The `merchantId` compliance-owned rows are stamped with: the business's
   * Sync2Books company id when it has one, its own id otherwise. This is the
   * same rule the dashboard uses (see BusinessSummaryResponse.merchantId).
   */
  async merchantIdFor(tenantId: string): Promise<string> {
    const tenant = await this.organizations.getTenantById(tenantId);
    if (!tenant) throw new NotFoundException('Business not found');
    return tenant.sync2booksCompanyId ?? tenant.id;
  }

  /**
   * The branch a request operates on, in canonical form. Omitted means the
   * business's default (headquarters) branch; a named one must belong to this
   * business -- `sync2booksBranchId` is only unique per tenant, so it is
   * resolved within the tenant, never across all of them.
   */
  async resolveBranch(
    tenantId: string,
    requested?: string | null,
  ): Promise<ComplianceBranch> {
    const branches = await this.organizations.listBranches(tenantId);

    if (requested) {
      const match =
        branches.find((b) => b.id === requested) ??
        branches.find((b) => b.sync2booksBranchId === requested) ??
        branches.find((b) => b.kraBhfId === requested);
      if (!match) throw new NotFoundException(`Branch ${requested} not found`);
      return match;
    }

    const fallback = branches[0];
    if (!fallback) {
      throw new NotFoundException(
        'This business has no branch yet. Complete its setup in the compliance dashboard.',
      );
    }
    return fallback;
  }

  async requireItem(merchantId: string, itemId: string): Promise<CatalogItem> {
    const item = await this.catalog.getItemById(itemId);
    // Deleted items are gone as far as a caller is concerned: selling one would
    // resurrect a code the merchant chose to retire.
    if (!item || item.merchantId !== merchantId || item.deletedAt) {
      throw new NotFoundException(`Item ${itemId} not found`);
    }
    return item;
  }

  async requireItems(
    merchantId: string,
    itemIds: string[],
  ): Promise<Map<string, CatalogItem>> {
    const items = new Map<string, CatalogItem>();
    for (const id of [...new Set(itemIds)]) {
      // Each id is checked against the business on its own, so one foreign id
      // refuses the whole line set before anything is created.
      items.set(id, await this.requireItem(merchantId, id));
    }
    return items;
  }

  async requireSale(
    merchantId: string,
    saleId: string,
  ): Promise<ComplianceDocument> {
    let document: ComplianceDocument;
    try {
      document = (await this.sales.getDocument(saleId)).document;
    } catch {
      // getDocument throws a bare Error for an unknown id.
      throw new NotFoundException(`Sale ${saleId} not found`);
    }
    if (document.merchantId !== merchantId) {
      throw new NotFoundException(`Sale ${saleId} not found`);
    }
    return document;
  }
}
