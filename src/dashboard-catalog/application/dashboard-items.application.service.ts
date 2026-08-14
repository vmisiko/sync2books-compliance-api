import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CatalogService } from '../../catalog/api/catalog.service';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { MainApiConnectionApplicationService } from '../../integration/main-api-pull/application/main-api-connection.application.service';
import { MainApiPullClient } from '../../integration/main-api-pull/infrastructure/http/main-api-pull.client';
import { mapMainApiItemToRegisterItemInput } from '../../catalog/infrastructure/main-api/main-api-item.mapper';

export type PullItemsResult = {
  merchantId: string;
  attempted: number;
  succeeded: number;
  failed: number;
  results: Array<{
    mainApiItemId: string;
    catalogItemId?: string;
    created?: boolean;
    classificationCode?: string;
    status: 'ok' | 'error';
    error?: string;
  }>;
};

@Injectable()
export class DashboardItemsApplicationService {
  private readonly logger = new Logger(DashboardItemsApplicationService.name);

  constructor(
    private readonly catalog: CatalogService,
    private readonly organization: ComplianceOrganizationApplicationService,
    private readonly mainApiConnections: MainApiConnectionApplicationService,
    private readonly mainApiPull: MainApiPullClient,
  ) {}

  async pullItems(complianceTenantId: string): Promise<PullItemsResult> {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const connection = await this.mainApiConnections.getForTenant(complianceTenantId);

    // Best-effort: refresh the main API's own cache from QuickBooks first, so
    // the list below isn't stale. A failure here (e.g. QuickBooks token expired)
    // shouldn't block reading whatever the main API already has.
    if (connection.quickbooksConnectionId) {
      try {
        await this.mainApiPull.syncItemsFromBookkeeping(
          connection.mainApiApiKey,
          connection.quickbooksConnectionId,
        );
      } catch (error) {
        this.logger.warn(
          `sync-from-bookkeeping (items) failed for tenant ${complianceTenantId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const results: PullItemsResult['results'] = [];
    let page = 1;
    const limit = 100;
    let totalPages = 1;

    do {
      const response = await this.mainApiPull.getItems(connection.mainApiApiKey, {
        page,
        limit,
      });
      totalPages = response.totalPages || 1;

      for (const mainApiItem of response.data) {
        try {
          const input = mapMainApiItemToRegisterItemInput({
            merchantId,
            item: mainApiItem,
          });
          const result = await this.catalog.registerItem(input);
          results.push({
            mainApiItemId: mainApiItem.id,
            catalogItemId: result.item.id,
            created: result.created,
            classificationCode: result.item.classificationCode,
            status: 'ok',
          });
        } catch (error) {
          results.push({
            mainApiItemId: mainApiItem.id,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      page += 1;
    } while (page <= totalPages);

    return {
      merchantId,
      attempted: results.length,
      succeeded: results.filter((r) => r.status === 'ok').length,
      failed: results.filter((r) => r.status === 'error').length,
      results,
    };
  }

  async listItems(complianceTenantId: string) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    return this.catalog.listItems(merchantId);
  }

  async overrideClassification(
    complianceTenantId: string,
    itemId: string,
    classificationCode: string,
  ) {
    const merchantId = await this.resolveMerchantId(complianceTenantId);
    const existing = await this.catalog.getItemById(itemId);
    if (!existing || existing.merchantId !== merchantId) {
      throw new NotFoundException(`Item ${itemId} not found`);
    }

    const result = await this.catalog.registerItem({
      merchantId: existing.merchantId,
      externalId: existing.externalId,
      name: existing.name,
      sku: existing.sku,
      itemType: existing.itemType,
      taxCategory: existing.taxCategory,
      classificationCode,
    });
    return result.item;
  }

  private async resolveMerchantId(complianceTenantId: string): Promise<string> {
    const tenant = await this.organization.getTenantById(complianceTenantId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${complianceTenantId} not found`);
    }
    if (!tenant.sync2booksCompanyId) {
      throw new BadRequestException(
        'This tenant has no sync2booksCompanyId configured — cannot resolve catalog merchantId',
      );
    }
    return tenant.sync2booksCompanyId;
  }
}
