import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ComplianceOrganizationApplicationService } from '../../compliance-organization/application/compliance-organization.application.service';
import { MerchantIdOptional } from '../../dashboard-identity/infrastructure/guards/merchant-id-optional.decorator';
import {
  findTenantForMerchant,
  tenantBelongsToOrganization,
} from '../../dashboard-identity/infrastructure/guards/merchant-tenant';
import type { DashboardRequestUser } from '../../dashboard-identity/infrastructure/strategies/dashboard-jwt.strategy';
import type { IComplianceDocumentRepository } from '../../shared/ports/repository.port';
import { DOCUMENT_REPO } from '../../shared/tokens';

/**
 * Ownership check for dashboard routes addressed by a document id
 * (`:id` on `dashboard-api/sales/:id`, `/:id/receipt`, `/:id/email`).
 *
 * MerchantOwnershipGuard only sees a `merchantId` in the path, query or body,
 * and a by-id route carries none, so on its own it waved every such request
 * through: any signed-in user of any organization could read another
 * organization's sale, download its KRA receipt, or have that receipt emailed
 * to an address of their choosing, given only the document id.
 *
 * This loads the document, resolves the business it belongs to, and requires
 * that business to belong to the caller's organization. A document that
 * doesn't exist, one that belongs to someone else, and one whose business has
 * no owner all answer the same 404 -- never a 403, which would confirm that the
 * id exists.
 */
@Injectable()
export class SaleOwnershipGuard implements CanActivate {
  constructor(
    @Inject(DOCUMENT_REPO)
    private readonly documents: IComplianceDocumentRepository,
    private readonly organizations: ComplianceOrganizationApplicationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: DashboardRequestUser }>();

    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Missing organization context');
    }

    const id = (req.params as Record<string, unknown> | undefined)?.id;
    const document =
      typeof id === 'string' && id !== ''
        ? await this.documents.findById(id)
        : null;
    const tenant = document
      ? await findTenantForMerchant(this.organizations, document.merchantId)
      : null;

    if (!tenantBelongsToOrganization(tenant, organizationId)) {
      throw new NotFoundException('Sale not found');
    }
    return true;
  }
}

/**
 * For a sales route addressed by `:id`: the caller's organization must own the
 * document. Also marks the route `@MerchantIdOptional()`, since the class-level
 * MerchantOwnershipGuard has no merchantId to look at here.
 */
export const OwnedSaleRoute = () =>
  applyDecorators(MerchantIdOptional(), UseGuards(SaleOwnershipGuard));
