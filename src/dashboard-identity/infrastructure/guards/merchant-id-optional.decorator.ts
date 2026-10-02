import { SetMetadata } from '@nestjs/common';

export const MERCHANT_ID_OPTIONAL = 'dashboard:merchantIdOptional';

/**
 * Marks a route under MerchantOwnershipGuard as one that does not take a
 * `merchantId` from the request, because something else scopes it: an
 * ActiveTenantGuard on the same controller, or a guard that resolves a resource
 * id to its owner (SaleOwnershipGuard). Without it MerchantOwnershipGuard
 * refuses a request that names no merchantId — so a new route that forgets to
 * carry one fails loudly instead of running unscoped.
 */
export const MerchantIdOptional = () => SetMetadata(MERCHANT_ID_OPTIONAL, true);
