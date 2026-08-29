import { BadGatewayException } from '@nestjs/common';

/**
 * ONE Main API Application shared by every compliance tenant, minted once per
 * environment (see .env's MAIN_API_APPLICATION_ID/MAIN_API_API_KEY comment) —
 * replaces the old per-tenant/per-organization Application provisioning.
 */
export type GlobalMainApiCredentials = {
  mainApiApplicationId: string;
  mainApiApiKey: string;
};

export function getGlobalMainApiCredentials(): GlobalMainApiCredentials {
  const mainApiApplicationId = process.env.MAIN_API_APPLICATION_ID?.trim();
  const mainApiApiKey = process.env.MAIN_API_API_KEY?.trim();
  if (!mainApiApplicationId || !mainApiApiKey) {
    throw new BadGatewayException(
      'MAIN_API_APPLICATION_ID / MAIN_API_API_KEY are not configured',
    );
  }
  return { mainApiApplicationId, mainApiApiKey };
}
