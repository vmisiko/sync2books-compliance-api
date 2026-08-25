/**
 * Throwaway manual smoke test — NOT part of the app, not wired into any module.
 * Run with:
 *   node --env-file=.env -r ts-node/register -r tsconfig-paths/register src/regulatory/oscu/slade360-smoke-test.script.ts
 * Safe to delete after use.
 */
import { fetchSlade360AccessToken } from './transport/slade360-client-credentials';
import { EtimsAdapterSlade360 } from './adapters/etims-adapter.slade360';
import type { EtimsConnectionContext } from './ports/etims-adapter.port';

async function main() {
  const clientId = process.env.SLADE360_CLIENT_ID;
  const clientSecret = process.env.SLADE360_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('SLADE360_CLIENT_ID / SLADE360_CLIENT_SECRET not set in env');
  }
  const authBaseUrl =
    process.env.SLADE360_AUTH_BASE_URL ?? 'https://identity-dev.slade360edi.com';
  const apiBaseUrl =
    process.env.SLADE360_API_BASE_URL ?? 'https://api-dev.slade360edi.com/erp';

  console.log('=== Step 1: token exchange ===');
  console.log('authBaseUrl:', authBaseUrl, ' clientId:', clientId);
  const { accessToken, raw } = await fetchSlade360AccessToken({
    authBaseUrl,
    clientId,
    clientSecret,
  });
  console.log('OK — token acquired. length:', accessToken.length);
  console.log('raw (minus token):', {
    ...raw,
    access_token: `<${accessToken.length} chars>`,
  });

  console.log('\n=== Step 2: fetch organisation branches (read-only) ===');
  const adapter = new EtimsAdapterSlade360({
    authBaseUrl,
    apiBaseUrl,
    clientId,
    clientSecret,
  });
  const ctx: EtimsConnectionContext = {
    merchantId: 'smoke-test',
    branchId: process.env.SLADE360_TEST_BHF_ID ?? '00',
    kraPin: process.env.SLADE360_TEST_KRA_PIN ?? '',
    environment: 'SANDBOX',
    cmcKey: '',
    deviceId: '',
    workstationId: process.env.SLADE360_WORKSTATION_ID,
  };
  const branches = await adapter.branchList({}, ctx);
  console.log(JSON.stringify(branches, null, 2));

  console.log('\n=== Step 3: initializeOscu go-live check ===');
  const initResult = await adapter.initializeOscu(
    { tin: ctx.kraPin || 'P000000000A', bhfId: ctx.branchId, dvcSrlNo: 'TEST-SRL' },
    ctx,
  );
  console.log(JSON.stringify(initResult, null, 2));
}

main().catch((e) => {
  console.error('\nFAILED:', e);
  process.exitCode = 1;
});
